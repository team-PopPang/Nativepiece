import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ResolvedConfig } from '../config.js';
import type { RNProject } from '../project.js';
import { workspaceDir } from '../project.js';
import { buildFrameworks, loadCachedFrameworks } from '../ios/frameworks.js';
import { assembleSwiftPackage } from '../ios/package.js';
import { prepareIOSWorkspace, type IOSWorkspace } from '../ios/workspace.js';
import { packagePath } from '../utils/assets.js';
import { run } from '../utils/exec.js';
import { Fingerprint } from '../utils/fingerprint.js';
import { log } from '../utils/log.js';
import { bundle } from './bundle.js';

export interface BuildIOSOptions {
  force?: boolean;
  forcePodInstall?: boolean;
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
  return fingerprint.digest();
}

// 네이티브 XCFramework 결과에 영향을 주는 입력이다. JS만 바뀌면 이 값이 같아서 archive를 건너뛴다.
async function frameworksFingerprint(config: ResolvedConfig, workspace: IOSWorkspace): Promise<string> {
  const xcodeVersion = await run('xcodebuild', ['-version'], { inherit: false });
  return new Fingerprint('nativepiece-ios-frameworks-v1')
    .value('cli', cliVersion())
    .value('xcode', xcodeVersion)
    .value('deploymentTarget', config.ios.deploymentTarget)
    .value('prebuilts', config.ios.useRNPrebuilts)
    .value('stripSimulatorDebugSymbols', config.ios.stripSimulatorDebugSymbols)
    .file(path.join(workspace.dir, 'Podfile.lock'))
    .digest();
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
  const jsBundle = await bundle(config, project, 'ios');

  log.step('iOS 작업 공간 준비');
  const workspace = await prepareIOSWorkspace(config, project);
  await installPodsIfNeeded(config, project, workspace, Boolean(options.forcePodInstall));

  const fingerprint = await frameworksFingerprint(config, workspace);
  const cacheDir = path.join(workspace.dir, 'build', 'frameworks', fingerprint);
  let frameworks = options.force ? null : await loadCachedFrameworks(cacheDir);
  if (frameworks) {
    log.info('네이티브 입력이 바뀌지 않아 Xcode archive를 건너뛰어요.');
  } else {
    frameworks = await buildFrameworks(workspace, config, cacheDir);
  }

  log.step('Swift Package 생성');
  const outDir = workspaceDir(project.root, 'output', 'ios', config.name);
  await assembleSwiftPackage(config, frameworks, jsBundle, outDir);

  log.success(`Swift Package를 만들었어요: ${outDir}`);
  return outDir;
}
