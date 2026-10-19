import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ResolvedConfig } from '../config.js';
import { assetPath } from '../utils/assets.js';
import { run } from '../utils/exec.js';
import { log } from '../utils/log.js';
import { PODS_SCHEME, PREBUILD_TARGET, type IOSWorkspace } from './workspace.js';
import { readLinkerFlags, type LinkerFlags } from './linker-flags.js';
import { prelinkStaticFrameworks, type ForceLoadSymbol } from './prelink.js';

const PLIST_BUDDY = '/usr/libexec/PlistBuddy';

export interface FrameworksOutput {
  dir: string;
  names: string[];
  linkerFlags: LinkerFlags;
  forceLoadSymbols: ForceLoadSymbol[];
}

async function plist(plistPath: string, command: string): Promise<string | null> {
  try {
    return (await run(PLIST_BUDDY, ['-c', command, plistPath], { inherit: false })).trim();
  } catch {
    return null;
  }
}

async function findDirs(root: string, predicate: (fullPath: string, name: string) => boolean): Promise<string[]> {
  const results: string[] = [];
  const walk = async (dir: string) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      const fullPath = path.join(dir, entry.name);
      if (predicate(fullPath, entry.name)) results.push(fullPath);
      await walk(fullPath);
    }
  };
  if (existsSync(root)) await walk(root);
  return results;
}

export type IOSConfiguration = 'Debug' | 'Release';

async function archive(
  workspace: IOSWorkspace,
  config: ResolvedConfig,
  configuration: IOSConfiguration,
  sdk: string,
  archivePath: string,
  derivedData: string,
) {
  await run(
    'xcodebuild',
    [
      'archive',
      '-workspace',
      workspace.xcworkspace,
      '-scheme',
      PODS_SCHEME,
      '-archivePath',
      archivePath,
      '-derivedDataPath',
      derivedData,
      '-configuration',
      configuration,
      '-sdk',
      sdk,
      '-quiet',
      'SKIP_INSTALL=NO',
      'BUILD_LIBRARY_FOR_DISTRIBUTION=YES',
      `IPHONEOS_DEPLOYMENT_TARGET=${config.ios.deploymentTarget}`,
      'CLANG_ENABLE_EXPLICIT_MODULES=NO',
      'SWIFT_ENABLE_EXPLICIT_MODULES=NO',
    ],
    { cwd: workspace.dir },
  );
}

// 시뮬레이터와 기기 archive에 모두 있는 framework만 XCFramework로 묶는다.
async function createXCFrameworks(simArchive: string, deviceArchive: string, outDir: string): Promise<void> {
  const simFrameworks = path.join(simArchive, 'Products', 'Library', 'Frameworks');
  const deviceFrameworks = path.join(deviceArchive, 'Products', 'Library', 'Frameworks');
  let created = 0;

  for (const name of (await readdir(simFrameworks)).filter((entry) => entry.endsWith('.framework'))) {
    const deviceFramework = path.join(deviceFrameworks, name);
    if (!existsSync(deviceFramework)) {
      log.warn(`기기용 framework가 없어 건너뛰어요: ${name}`);
      continue;
    }
    await run(
      'xcodebuild',
      [
        '-create-xcframework',
        '-framework',
        path.join(simFrameworks, name),
        '-framework',
        deviceFramework,
        '-output',
        path.join(outDir, name.replace(/\.framework$/, '.xcframework')),
      ],
      { inherit: false },
    );
    created += 1;
  }

  if (created === 0) throw new Error('XCFramework로 묶을 framework가 없어요.');
}

async function copyPrebuilts(workspace: IOSWorkspace, config: ResolvedConfig, outDir: string): Promise<void> {
  const pods = path.join(workspace.dir, 'Pods');
  const sources: [string, string][] = [
    [path.join(pods, 'hermes-engine', 'destroot', 'Library', 'Frameworks', 'universal', 'hermesvm.xcframework'), 'hermesvm'],
  ];
  if (config.ios.useRNPrebuilts) {
    sources.push(
      [path.join(pods, 'React-Core-prebuilt', 'React.xcframework'), 'React'],
      [
        path.join(pods, 'ReactNativeDependencies', 'framework', 'packages', 'react-native', 'ReactNativeDependencies.xcframework'),
        'ReactNativeDependencies',
      ],
    );
  }

  for (const [source, name] of sources) {
    if (!existsSync(source)) {
      throw new Error(`prebuilt framework를 찾지 못했어요 (${name}): ${source}`);
    }
    await run('ditto', [source, path.join(outDir, `${name}.xcframework`)]);
  }
}

// CocoaPods의 VFS overlay로만 보이는 React 헤더를 SwiftPM이 읽을 수 있게 실제 파일로 옮긴다.
async function materializeReactHeaders(workspace: IOSWorkspace, config: ResolvedConfig, outDir: string): Promise<void> {
  if (!config.ios.useRNPrebuilts) return;
  await run('ruby', [
    assetPath('ios', 'materialize_react_vfs_headers.rb'),
    path.join(outDir, 'React.xcframework'),
    path.join(outDir, 'ReactNativeDependencies.xcframework'),
    path.join(workspace.dir, 'Pods', 'hermes-engine', 'destroot', 'include', 'hermes'),
    outDir,
    config.ios.deploymentTarget,
    // RN 0.88부터는 VFS 대신 이 폴더에 이름공간별 헤더가 있다.
    path.join(workspace.dir, 'Pods', 'React-Core-prebuilt', 'Headers'),
  ]);
}

// App Store Connect가 embedded framework의 MinimumOSVersion을 요구하므로 기기 slice 값을 통일한다.
async function normalizeMinimumOSVersion(outDir: string, deploymentTarget: string): Promise<void> {
  const frameworks = await findDirs(
    outDir,
    (fullPath, name) =>
      name.endsWith('.framework') && /\/ios-[^/]+\//.test(fullPath) && !/-(simulator|maccatalyst)\//.test(fullPath),
  );
  for (const framework of frameworks) {
    const infoPlist = path.join(framework, 'Info.plist');
    if (!existsSync(infoPlist)) continue;
    await plist(infoPlist, 'Delete :MinimumOSVersion');
    await run(PLIST_BUDDY, ['-c', `Add :MinimumOSVersion string ${deploymentTarget}`, infoPlist], { inherit: false });
  }
}

// iOS 기기와 시뮬레이터 slice만 남기고 Mac Catalyst, macOS, tvOS, visionOS slice를 지운다.
async function removeUnusedSlices(outDir: string): Promise<void> {
  for (const xcframework of (await readdir(outDir)).filter((entry) => entry.endsWith('.xcframework'))) {
    const xcframeworkPath = path.join(outDir, xcframework);
    const infoPlist = path.join(xcframeworkPath, 'Info.plist');
    let index = 0;
    for (;;) {
      const identifier = await plist(infoPlist, `Print :AvailableLibraries:${index}:LibraryIdentifier`);
      if (identifier === null) break;
      const platform = await plist(infoPlist, `Print :AvailableLibraries:${index}:SupportedPlatform`);
      const variant = await plist(infoPlist, `Print :AvailableLibraries:${index}:SupportedPlatformVariant`);
      if (platform === 'ios' && (variant === null || variant === 'simulator')) {
        index += 1;
        continue;
      }
      await rm(path.join(xcframeworkPath, identifier), { recursive: true, force: true });
      await run(PLIST_BUDDY, ['-c', `Delete :AvailableLibraries:${index}`, infoPlist], { inherit: false });
    }
  }
}

// 시뮬레이터 slice의 정적 라이브러리 디버그 정보를 지워 패키지 크기를 줄인다.
// 기기 slice는 크래시 분석을 위해 그대로 둔다.
async function stripSimulatorDebugInfo(outDir: string): Promise<void> {
  const frameworks = await findDirs(outDir, (fullPath, name) => name.endsWith('.framework') && /\/ios-[^/]+-simulator\//.test(fullPath));
  for (const framework of frameworks) {
    const binary = path.join(framework, path.basename(framework, '.framework'));
    if (!existsSync(binary)) continue;
    const kind = await run('file', ['-b', binary], { inherit: false });
    if (!kind.includes('ar archive')) continue;
    await run('xcrun', ['strip', '-S', binary], { inherit: false });
  }
}

// 헤더를 수정해 무효가 된 서명을 지운다. 최종 서명은 소비 앱 빌드에서 이뤄진다.
async function stripSignatures(outDir: string): Promise<void> {
  for (const signature of await findDirs(outDir, (_, name) => name === '_CodeSignature')) {
    await rm(signature, { recursive: true, force: true });
  }
}

export async function loadCachedFrameworks(cacheDir: string): Promise<FrameworksOutput | null> {
  const manifestPath = path.join(cacheDir, 'manifest.json');
  if (!existsSync(manifestPath)) return null;
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Omit<FrameworksOutput, 'dir'>;
  if (!manifest.forceLoadSymbols) return null;
  if (!manifest.names.every((name) => existsSync(path.join(cacheDir, 'Frameworks', `${name}.xcframework`)))) return null;
  return { dir: path.join(cacheDir, 'Frameworks'), ...manifest };
}

// Pods를 archive해 배포용 XCFramework 세트를 만든다. 결과는 fingerprint별 캐시 디렉터리에 저장한다.
// configuration이 Debug면 RN의 debug prebuilt(개발 메뉴, Fast Refresh 포함)를 쓰는 개발용 세트를 만든다.
export async function buildFrameworks(
  workspace: IOSWorkspace,
  config: ResolvedConfig,
  configuration: IOSConfiguration,
  cacheDir: string,
): Promise<FrameworksOutput> {
  const staging = `${cacheDir}.staging`;
  await rm(staging, { recursive: true, force: true });
  const frameworksDir = path.join(staging, 'Frameworks');
  await mkdir(frameworksDir, { recursive: true });

  const derivedData = path.join(workspace.dir, 'build', `DerivedData-${configuration}`);
  const simArchive = path.join(staging, 'archives', `${PREBUILD_TARGET}-iphonesimulator.xcarchive`);
  const deviceArchive = path.join(staging, 'archives', `${PREBUILD_TARGET}-iphoneos.xcarchive`);

  log.step(`Xcode archive (iOS Simulator, ${configuration})`);
  await archive(workspace, config, configuration, 'iphonesimulator', simArchive, derivedData);
  log.step(`Xcode archive (iOS, ${configuration})`);
  await archive(workspace, config, configuration, 'iphoneos', deviceArchive, derivedData);

  log.step('XCFramework 생성');
  await createXCFrameworks(simArchive, deviceArchive, frameworksDir);
  await copyPrebuilts(workspace, config, frameworksDir);
  await materializeReactHeaders(workspace, config, frameworksDir);

  log.step('XCFramework 정리');
  await normalizeMinimumOSVersion(frameworksDir, config.ios.deploymentTarget);
  await removeUnusedSlices(frameworksDir);
  if (config.ios.stripSimulatorDebugSymbols) await stripSimulatorDebugInfo(frameworksDir);
  // 원격 Swift Package에서도 -ObjC 없이 네이티브 모듈이 모두 링크되게 한다.
  await rm(path.join(frameworksDir, `Pods_${PREBUILD_TARGET}.xcframework`), { recursive: true, force: true });
  log.step('정적 framework 미리 합치기');
  const forceLoadSymbols = await prelinkStaticFrameworks(frameworksDir, config.ios.deploymentTarget);
  await stripSignatures(frameworksDir);
  await rm(path.join(staging, 'archives'), { recursive: true, force: true });


  const names = (await readdir(frameworksDir))
    .filter((entry) => entry.endsWith('.xcframework'))
    .map((entry) => entry.replace(/\.xcframework$/, ''))
    .sort();
  const linkerFlags = await readLinkerFlags(workspace.dir, new Set(names));

  await writeFile(path.join(staging, 'manifest.json'), JSON.stringify({ names, linkerFlags, forceLoadSymbols }, null, 2));
  await rm(cacheDir, { recursive: true, force: true });
  await rename(staging, cacheDir);

  return { dir: path.join(cacheDir, 'Frameworks'), names, linkerFlags, forceLoadSymbols };
}
