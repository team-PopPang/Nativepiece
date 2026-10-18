import { existsSync, readFileSync } from 'node:fs';
import { cp, mkdir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import type { ResolvedConfig } from '../config.js';
import type { RNProject } from '../project.js';
import { LINKAGE_PROJECT, prepareAndroidWorkspace, type AndroidWorkspace } from '../android/workspace.js';
import { run } from '../utils/exec.js';
import { log } from '../utils/log.js';
import { BUNDLE_FILE_NAME, bundle } from './bundle.js';

const JDK_CANDIDATES = [
  '/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home',
  '/usr/local/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home',
];

function isJdk17(home: string | undefined): home is string {
  if (!home) return false;
  const release = path.join(home, 'release');
  return existsSync(path.join(home, 'bin', 'java')) && existsSync(release) && /JAVA_VERSION="17\./.test(readFileSync(release, 'utf8'));
}

// Gradle은 JDK 17로 실행한다. JAVA_HOME이 17이 아니면 알려진 설치 위치를 찾는다.
async function resolveJavaHome(): Promise<string> {
  const candidates = [process.env.JAVA_HOME_17, process.env.JAVA_HOME];
  try {
    candidates.push((await run('/usr/libexec/java_home', ['-v', '17'], { inherit: false })).trim());
  } catch {
    // java_home에 등록되지 않은 Homebrew JDK도 있으므로 아래 경로를 계속 확인한다.
  }
  candidates.push(...JDK_CANDIDATES);

  const found = candidates.find(isJdk17);
  if (!found) {
    throw new Error('JDK 17을 찾지 못했어요. JAVA_HOME_17을 설정하거나 `brew install openjdk@17`로 설치해 주세요.');
  }
  return found;
}

async function gradle(workspace: AndroidWorkspace, javaHome: string, args: string[]) {
  await run(path.join(workspace.dir, 'gradlew'), ['-p', workspace.dir, '--console=plain', ...args], {
    cwd: workspace.dir,
    env: { JAVA_HOME: javaHome, PATH: `${path.join(javaHome, 'bin')}:${process.env.PATH}` },
  });
}

async function findFiles(root: string, predicate: (name: string) => boolean): Promise<string[]> {
  const results: string[] = [];
  const walk = async (dir: string) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(fullPath);
      else if (predicate(entry.name)) results.push(fullPath);
    }
  };
  if (existsSync(root)) await walk(root);
  return results;
}

// 빈 앱 모듈을 빌드해 C++ autolinking 결과(.so)를 SDK 모듈의 jniLibs로 옮긴다.
async function collectLinkageLibraries(workspace: AndroidWorkspace, javaHome: string, abis: string[]) {
  log.step('C++ autolinking 빌드');
  await gradle(workspace, javaHome, [`:${LINKAGE_PROJECT}:mergeReleaseNativeLibs`]);

  const mergedDir = path.join(workspace.dir, LINKAGE_PROJECT, 'build', 'intermediates', 'merged_native_libs', 'release');
  const libraries = await findFiles(mergedDir, (name) => name === 'libappmodules.so' || /^libreact_codegen_.+\.so$/.test(name));
  const jniLibsDir = path.join(workspace.sdkDir, 'src', 'generated', 'jniLibs');
  await rm(jniLibsDir, { recursive: true, force: true });

  for (const library of libraries) {
    const abi = path.basename(path.dirname(library));
    await mkdir(path.join(jniLibsDir, abi), { recursive: true });
    await cp(library, path.join(jniLibsDir, abi, path.basename(library)));
  }

  for (const abi of abis) {
    if (!existsSync(path.join(jniLibsDir, abi, 'libappmodules.so'))) {
      throw new Error(`libappmodules.so를 찾지 못했어요 (${abi}): ${mergedDir}`);
    }
  }
}

async function copyBundle(workspace: AndroidWorkspace, bundleDir: string) {
  const generated = path.join(workspace.sdkDir, 'src', 'generated');
  await mkdir(path.join(generated, 'assets'), { recursive: true });
  await cp(path.join(bundleDir, BUNDLE_FILE_NAME.android), path.join(generated, 'assets', BUNDLE_FILE_NAME.android));
  const resDir = path.join(bundleDir, 'res');
  if (existsSync(resDir)) await cp(resDir, path.join(generated, 'res'), { recursive: true });
}

export async function buildAndroid(config: ResolvedConfig, project: RNProject): Promise<string> {
  if (!config.android) throw new Error('nativepiece.config.ts에 android 설정(group)이 필요해요.');
  const javaHome = await resolveJavaHome();

  const jsBundle = await bundle(config, project, 'android');

  log.step('Android 작업 공간 준비');
  const workspace = await prepareAndroidWorkspace(config, project);
  await copyBundle(workspace, jsBundle.dir);

  await collectLinkageLibraries(workspace, javaHome, config.android.abis);

  log.step('AAR 빌드와 Maven 저장소 발행');
  await rm(workspace.repositoryDir, { recursive: true, force: true });
  await gradle(workspace, javaHome, ['publishNativepiece']);

  const artifactDir = path.join(workspace.repositoryDir, ...config.android.group.split('.'), config.android.artifactId, config.version);
  const aar = path.join(artifactDir, `${config.android.artifactId}-${config.version}.aar`);
  if (!existsSync(aar)) throw new Error(`AAR이 만들어지지 않았어요: ${aar}`);

  const entries = await run('unzip', ['-l', aar], { inherit: false });
  for (const required of [`assets/${BUNDLE_FILE_NAME.android}`, 'libappmodules.so']) {
    if (!entries.includes(required)) throw new Error(`AAR에 ${required}이(가) 없어요: ${aar}`);
  }

  log.success(`Maven 저장소를 만들었어요: ${workspace.repositoryDir}`);
  log.info(`의존성: implementation("${config.android.group}:${config.android.artifactId}:${config.version}")`);
  return workspace.repositoryDir;
}
