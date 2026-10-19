import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pc from 'picocolors';
import { findConfigPath, loadConfig } from '../config.js';
import { contractPath, generateSources } from '../codegen/index.js';
import type { RNProject } from '../project.js';
import { commandExists, run } from '../utils/exec.js';
import { log } from '../utils/log.js';
import { resolveJavaHome } from './build-android.js';

export type CheckLevel = 'ok' | 'warn' | 'error';

export interface CheckResult {
  level: CheckLevel;
  title: string;
  detail?: string;
}

export const MIN_REACT_NATIVE = [0, 85] as const;
const MIN_NODE = [22, 11] as const;

// prebuilt React Native core와 함께 쓰면 iOS 빌드가 깨지는 것으로 알려진 라이브러리다.
const PREBUILT_CONFLICTS = [/^@react-native-firebase\//];

function versionAtLeast(version: string, minimum: readonly number[]): boolean {
  const parts = version.replace(/^[^0-9]*/, '').split('.').map((part) => Number.parseInt(part, 10) || 0);
  for (let index = 0; index < minimum.length; index += 1) {
    if ((parts[index] ?? 0) > minimum[index]) return true;
    if ((parts[index] ?? 0) < minimum[index]) return false;
  }
  return true;
}

function dependencies(project: RNProject): Record<string, string> {
  const packageJson = JSON.parse(readFileSync(path.join(project.root, 'package.json'), 'utf8'));
  return { ...packageJson.dependencies, ...packageJson.devDependencies };
}

function installedVersion(project: RNProject, name: string): string | null {
  const packageJsonPath = path.join(project.root, 'node_modules', name, 'package.json');
  return existsSync(packageJsonPath) ? JSON.parse(readFileSync(packageJsonPath, 'utf8')).version : null;
}

// 모듈 프로젝트 자체의 호환성. init도 이 검사를 쓴다.
export function checkProject(project: RNProject): CheckResult[] {
  const results: CheckResult[] = [];
  const minimum = MIN_REACT_NATIVE.join('.');

  results.push(
    versionAtLeast(project.reactNativeVersion, MIN_REACT_NATIVE)
      ? { level: 'ok', title: `React Native ${project.reactNativeVersion}` }
      : {
          level: 'error',
          title: `React Native ${project.reactNativeVersion}은 지원하지 않아요`,
          detail: `${minimum} 이상이 필요해요. prebuilt core와 New Architecture가 기본인 버전부터 지원해요.`,
        },
  );

  const gradleProperties = path.join(project.root, 'android', 'gradle.properties');
  if (existsSync(gradleProperties) && /^\s*hermesEnabled\s*=\s*false/m.test(readFileSync(gradleProperties, 'utf8'))) {
    results.push({ level: 'error', title: 'Android에서 Hermes가 꺼져 있어요', detail: 'Nativepiece는 Hermes만 지원해요.' });
  }
  const podfile = path.join(project.root, 'ios', 'Podfile');
  if (existsSync(podfile) && /:hermes_enabled\s*=>\s*false/.test(readFileSync(podfile, 'utf8'))) {
    results.push({ level: 'error', title: 'iOS에서 Hermes가 꺼져 있어요', detail: 'Nativepiece는 Hermes만 지원해요.' });
  }

  const xcodeEnvLocal = path.join(project.root, 'ios', '.xcode.env.local');
  if (existsSync(xcodeEnvLocal) && /NODE_BINARY=\/(?!usr\/bin)/.test(readFileSync(xcodeEnvLocal, 'utf8'))) {
    results.push({
      level: 'warn',
      title: 'ios/.xcode.env.local에 머신마다 다른 node 경로가 있어요',
      detail: 'Nativepiece 빌드는 이 파일을 쓰지 않지만, 레포에 커밋돼 있다면 지우는 게 좋아요.',
    });
  }

  const deps = dependencies(project);
  for (const name of Object.keys(deps)) {
    if (PREBUILT_CONFLICTS.some((pattern) => pattern.test(name))) {
      results.push({
        level: 'warn',
        title: `${name}은(는) prebuilt React Native core와 충돌할 수 있어요`,
        detail: 'iOS 빌드가 실패하면 nativepiece.config.ts에서 ios.useRNPrebuilts를 false로 바꿔 주세요.',
      });
    }
  }

  // Reanimated 4는 react-native-worklets와 같은 이름의 .so(libworklets.so)를 함께 가져올 수 있다.
  const reanimated = installedVersion(project, 'react-native-reanimated');
  if (reanimated && versionAtLeast(reanimated, [4]) && deps['react-native-worklets']) {
    results.push({
      level: 'warn',
      title: 'react-native-reanimated 4와 react-native-worklets가 함께 있어요',
      detail: 'Android에서 libworklets.so가 중복될 수 있어요. 빌드가 실패하면 하나를 제외해 주세요.',
    });
  }

  return results;
}

async function checkEnvironment(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  results.push(
    versionAtLeast(process.versions.node, MIN_NODE)
      ? { level: 'ok', title: `Node ${process.versions.node}` }
      : { level: 'error', title: `Node ${process.versions.node}`, detail: `${MIN_NODE.join('.')} 이상이 필요해요.` },
  );

  if (process.platform === 'darwin') {
    if (await commandExists('xcodebuild')) {
      const version = (await run('xcodebuild', ['-version'], { inherit: false })).split('\n')[0];
      results.push({ level: 'ok', title: version });
    } else {
      results.push({ level: 'error', title: 'Xcode가 없어요', detail: 'iOS 빌드에 필요해요.' });
    }
    results.push(
      (await commandExists('pod'))
        ? { level: 'ok', title: `CocoaPods ${(await run('pod', ['--version'], { inherit: false })).trim()}` }
        : { level: 'error', title: 'CocoaPods가 없어요', detail: 'iOS 빌드에 필요해요. `brew install cocoapods`' },
    );
  } else {
    results.push({ level: 'warn', title: 'macOS가 아니라서 iOS 빌드는 할 수 없어요' });
  }

  try {
    results.push({ level: 'ok', title: `JDK 17 (${await resolveJavaHome()})` });
  } catch (error) {
    results.push({ level: 'error', title: 'JDK 17이 없어요', detail: (error as Error).message });
  }

  const sdk = [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT, path.join(os.homedir(), 'Library', 'Android', 'sdk')].find(
    (candidate) => candidate && existsSync(candidate),
  );
  results.push(
    sdk
      ? { level: 'ok', title: `Android SDK (${sdk})` }
      : { level: 'error', title: 'Android SDK가 없어요', detail: 'ANDROID_HOME을 설정해 주세요.' },
  );

  return results;
}

async function checkConfig(project: RNProject): Promise<CheckResult[]> {
  if (!findConfigPath(project.root)) {
    return [{ level: 'error', title: 'nativepiece.config.ts가 없어요', detail: '`npx nativepiece init`으로 만들 수 있어요.' }];
  }
  const results: CheckResult[] = [];
  try {
    const config = await loadConfig(project.root, project.packageVersion);
    results.push({ level: 'ok', title: `설정 (${config.name} ${config.version})` });
    if (!existsSync(path.resolve(project.root, config.entry))) {
      results.push({ level: 'error', title: `JS 진입점이 없어요: ${config.entry}` });
    }
    if (!existsSync(contractPath(config))) {
      results.push({ level: 'warn', title: `계약 파일이 없어요: ${config.contract}`, detail: '타입이 있는 Swift·Kotlin API가 만들어지지 않아요.' });
    } else {
      generateSources(config);
      results.push({ level: 'ok', title: `계약 (${config.contract})` });
    }
    if (!config.android) {
      results.push({ level: 'warn', title: 'android 설정이 없어요', detail: 'Android 빌드에는 android.group이 필요해요.' });
    }
  } catch (error) {
    results.push({ level: 'error', title: '설정 또는 계약에 문제가 있어요', detail: (error as Error).message });
  }
  if (!installedVersion(project, '@team-poppang/nativepiece-runtime')) {
    results.push({ level: 'error', title: '@team-poppang/nativepiece-runtime이 설치되지 않았어요', detail: '`npm install @team-poppang/nativepiece-runtime`' });
  }
  return results;
}

function print(section: string, results: CheckResult[]) {
  console.log(pc.bold(section));
  for (const result of results) {
    const icon = result.level === 'ok' ? pc.green('✔') : result.level === 'warn' ? pc.yellow('!') : pc.red('✖');
    console.log(`  ${icon} ${result.title}`);
    if (result.detail) console.log(pc.dim(`    ${result.detail}`));
  }
}

export async function doctor(project: RNProject): Promise<boolean> {
  const sections: [string, CheckResult[]][] = [
    ['프로젝트', checkProject(project)],
    ['설정', await checkConfig(project)],
    ['개발 환경', await checkEnvironment()],
  ];
  for (const [title, results] of sections) print(title, results);

  const all = sections.flatMap(([, results]) => results);
  const errors = all.filter((result) => result.level === 'error').length;
  const warnings = all.filter((result) => result.level === 'warn').length;
  console.log('');
  if (errors > 0) log.error(`해결해야 할 문제가 ${errors}개 있어요.`);
  else if (warnings > 0) log.warn(`빌드할 수 있어요. 확인할 경고가 ${warnings}개 있어요.`);
  else log.success('빌드할 준비가 됐어요.');
  return errors === 0;
}
