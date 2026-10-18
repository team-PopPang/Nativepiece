import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ResolvedConfig } from '../config.js';
import type { RNProject } from '../project.js';
import { workspaceDir } from '../project.js';
import { buildFrameworks, loadCachedFrameworks, type IOSConfiguration } from '../ios/frameworks.js';
import { assembleSwiftPackage } from '../ios/package.js';
import { prepareIOSWorkspace, type IOSWorkspace } from '../ios/workspace.js';
import { packagePath } from '../utils/assets.js';
import { run } from '../utils/exec.js';
import { Fingerprint } from '../utils/fingerprint.js';
import { log } from '../utils/log.js';
import { bundle } from './bundle.js';
import { generateSources } from '../codegen/index.js';

export interface BuildIOSOptions {
  force?: boolean;
  forcePodInstall?: boolean;
  // true면 Metro 개발 서버와 Fast Refresh를 쓸 수 있는 개발용 패키지를 만든다.
  dev?: boolean;
}

const LOCKFILES = ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb'];

function cliVersion(): string {
  return JSON.parse(readFileSync(packagePath('package.json'), 'utf8')).version;
}

function prebuiltEnv(config: ResolvedConfig): NodeJS.ProcessEnv {
  const value = config.ios.useRNPrebuilts ? '1' : '0';
  return { RCT_USE_PREBUILT_RNCORE: value, RCT_USE_RN_DEP: value, RCT_NEW_ARCH_ENABLED: '1' };
}

// pod install 결과에 영향을 주는 입력이다. JS 소스는 넣지 않는다.
function podFingerprint(config: ResolvedConfig, project: RNProject, workspace: IOSWorkspace): string {
  const fingerprint = new Fingerprint('nativepiece-ios-pods-v1')
    .value('cli', cliVersion())
    .value('prebuilts', config.ios.useRNPrebuilts)
    .file(workspace.podfile)
    .file(path.join(project.root, 'package.json'))
    .file(path.join(project.root, 'react-native.config.js'))
    .file(path.join(project.reactNativePath, 'package.json'));
  for (const lockfile of LOCKFILES) fingerprint.file(path.join(project.root, lockfile));
  for (const directory of localPodDirectories(workspace, project)) hashNativeSources(fingerprint, directory, false);
  return fingerprint.digest();
}

const NATIVE_SOURCE_EXTENSIONS = new Set(['.h', '.hpp', '.m', '.mm', '.c', '.cc', '.cpp', '.swift', '.podspec']);
const IGNORED_DIRECTORIES = new Set(['node_modules', 'android', 'example', 'examples', '.git', 'build']);

// Podfile.lock의 로컬 경로 Pod 중 react-native 밖에 있는 것을 찾는다.
// 이런 Pod은 버전이 같아도 소스가 바뀔 수 있어서(file: 의존성, patch-package 등) 소스를 직접 해시한다.
function localPodDirectories(workspace: IOSWorkspace, project: RNProject): string[] {
  const lockfile = path.join(workspace.dir, 'Podfile.lock');
  if (!existsSync(lockfile)) return [];
  const content = readFileSync(lockfile, 'utf8');
  const external = content.slice(content.indexOf('EXTERNAL SOURCES:'), content.indexOf('SPEC CHECKSUMS:'));
  const directories = new Set<string>();
  for (const match of external.matchAll(/:path: "([^"]+)"/g)) {
    const directory = path.resolve(workspace.dir, match[1]);
    if (directory === project.reactNativePath || directory.startsWith(`${project.reactNativePath}${path.sep}`)) continue;
    directories.add(directory);
  }
  return [...directories].sort();
}

// contents가 false면 파일 목록만 해시한다. 파일이 추가·삭제되면 Pods 프로젝트를 다시 만들어야 한다.
function hashNativeSources(fingerprint: Fingerprint, directory: string, contents = true) {
  const walk = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) walk(fullPath);
      } else if (NATIVE_SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
        if (contents) fingerprint.file(fullPath);
        else fingerprint.value('path', fullPath);
      }
    }
  };
  if (existsSync(directory)) walk(directory);
}

// 네이티브 XCFramework 결과에 영향을 주는 입력이다. JS만 바뀌면 이 값이 같아서 archive를 건너뛴다.
async function frameworksFingerprint(
  config: ResolvedConfig,
  project: RNProject,
  workspace: IOSWorkspace,
  configuration: IOSConfiguration,
): Promise<string> {
  const xcodeVersion = await run('xcodebuild', ['-version'], { inherit: false });
  const fingerprint = new Fingerprint('nativepiece-ios-frameworks-v2')
    .value('configuration', configuration)
    .value('cli', cliVersion())
    .value('xcode', xcodeVersion)
    .value('deploymentTarget', config.ios.deploymentTarget)
    .value('prebuilts', config.ios.useRNPrebuilts)
    .value('stripSimulatorDebugSymbols', config.ios.stripSimulatorDebugSymbols)
    .file(path.join(workspace.dir, 'Podfile.lock'));
  for (const directory of localPodDirectories(workspace, project)) hashNativeSources(fingerprint, directory);
  return fingerprint.digest();
}

async function installPodsIfNeeded(config: ResolvedConfig, project: RNProject, workspace: IOSWorkspace, force: boolean) {
  const fingerprint = podFingerprint(config, project, workspace);
  const stateFile = path.join(workspace.dir, 'build', 'pods.fingerprint');
  const lockfile = path.join(workspace.dir, 'Podfile.lock');
  const manifest = path.join(workspace.dir, 'Pods', 'Manifest.lock');

  const current =
    !force &&
    existsSync(stateFile) &&
    readFileSync(stateFile, 'utf8') === fingerprint &&
    existsSync(lockfile) &&
    existsSync(manifest) &&
    readFileSync(lockfile, 'utf8') === readFileSync(manifest, 'utf8');

  if (current) {
    log.info('Pods가 최신이라 pod install을 건너뛰어요.');
    return;
  }

  log.step('pod install');
  await run('pod', ['install'], { cwd: workspace.dir, env: prebuiltEnv(config) });
  await mkdir(path.dirname(stateFile), { recursive: true });
  await writeFile(stateFile, fingerprint);
}

export async function buildIOS(config: ResolvedConfig, project: RNProject, options: BuildIOSOptions = {}): Promise<string> {
  // 계약 오류는 오래 걸리는 네이티브 빌드 전에 알린다.
  log.step('계약 코드 생성');
  const generated = generateSources(config);
  const jsBundle = await bundle(config, project, 'ios');

  log.step('iOS 작업 공간 준비');
  const workspace = await prepareIOSWorkspace(config, project);
  await installPodsIfNeeded(config, project, workspace, Boolean(options.forcePodInstall));

  const configuration: IOSConfiguration = options.dev ? 'Debug' : 'Release';
  const fingerprint = await frameworksFingerprint(config, project, workspace, configuration);
  const cacheDir = path.join(workspace.dir, 'build', 'frameworks', fingerprint);
  let frameworks = options.force ? null : await loadCachedFrameworks(cacheDir);
  if (frameworks) {
    log.info('네이티브 입력이 바뀌지 않아 Xcode archive를 건너뛰어요.');
  } else {
    frameworks = await buildFrameworks(workspace, config, configuration, cacheDir);
  }

  log.step('Swift Package 생성');
  const outDir = workspaceDir(project.root, 'output', options.dev ? 'ios-dev' : 'ios', config.name);
  await assembleSwiftPackage(config, frameworks, jsBundle, generated, outDir);

  log.success(`Swift Package를 만들었어요${options.dev ? ' (개발용)' : ''}: ${outDir}`);
  if (options.dev) log.info('개발용 패키지는 앱 배포에 쓰지 마세요. `npx nativepiece dev`로 Metro를 띄운 뒤 start(devServer:)로 연결해요.');
  return outDir;
}
