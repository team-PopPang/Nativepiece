import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { mkdir, rm, rename } from 'node:fs/promises';
import path from 'node:path';
import type { ResolvedConfig } from '../config.js';
import type { RNProject } from '../project.js';
import { workspaceDir } from '../project.js';
import { run } from '../utils/exec.js';
import { log } from '../utils/log.js';

export type Platform = 'ios' | 'android';

export interface BundleOutput {
  dir: string;
  bundleFile: string;
  assetsDir: string;
  sourcemapFile: string;
}

export const BUNDLE_FILE_NAME: Record<Platform, string> = {
  ios: 'main.jsbundle',
  android: 'main.android.bundle',
};

// hermes-compiler는 react-native가 의존하는 버전을 써야 런타임과 바이트코드 버전이 맞는다.
function resolveHermesc(project: RNProject): string {
  const require = createRequire(path.join(project.reactNativePath, 'package.json'));
  const hermesCompilerDir = path.dirname(require.resolve('hermes-compiler/package.json'));
  const osBin = process.platform === 'darwin' ? 'osx-bin' : process.platform === 'win32' ? 'win64-bin' : 'linux64-bin';
  const hermesc = path.join(hermesCompilerDir, 'hermesc', osBin, process.platform === 'win32' ? 'hermesc.exe' : 'hermesc');
  if (!existsSync(hermesc)) {
    throw new Error(`hermesc를 찾지 못했어요: ${hermesc}`);
  }
  return hermesc;
}

// Metro로 번들을 만들고, 설정에 따라 Hermes 바이트코드로 컴파일한다.
export async function bundle(config: ResolvedConfig, project: RNProject, platform: Platform): Promise<BundleOutput> {
  const entryFile = path.resolve(project.root, config.entry);
  if (!existsSync(entryFile)) {
    throw new Error(`JS 진입점을 찾지 못했어요: ${entryFile}`);
  }

  const outDir = workspaceDir(project.root, 'bundle', platform);
  const assetsDir = path.join(outDir, 'assets');
  const bundleFile = path.join(outDir, BUNDLE_FILE_NAME[platform]);
  const sourcemapFile = path.join(outDir, 'sourcemaps', `${BUNDLE_FILE_NAME[platform]}.map`);
  const packagerBundle = path.join(outDir, `${BUNDLE_FILE_NAME[platform]}.packager.js`);
  const packagerSourcemap = `${packagerBundle}.map`;

  await rm(outDir, { recursive: true, force: true });
  await mkdir(assetsDir, { recursive: true });
  await mkdir(path.dirname(sourcemapFile), { recursive: true });

  log.step(`JS 번들 생성 (${platform}, Metro)`);
  const node = process.execPath;
  const rnCli = path.join(project.reactNativePath, 'cli.js');
  await run(
    node,
    [
      path.join(project.reactNativePath, 'scripts', 'bundle.js'),
      'bundle',
      '--config-cmd',
      `'${node}' '${rnCli}' config`,
      '--entry-file',
      entryFile,
      '--platform',
      platform,
      '--dev',
      'false',
      // Hermes가 최적화하므로 Metro 단계에서는 minify하지 않는다.
      '--minify',
      String(!config.hermes.bytecode),
      '--reset-cache',
      '--bundle-output',
      packagerBundle,
      '--sourcemap-output',
      packagerSourcemap,
      '--assets-dest',
      platform === 'ios' ? outDir : path.join(outDir, 'res'),
    ],
    { cwd: project.root },
  );

  if (!config.hermes.bytecode) {
    await rename(packagerBundle, bundleFile);
    await rename(packagerSourcemap, sourcemapFile);
    return { dir: outDir, bundleFile, assetsDir, sourcemapFile };
  }

  log.step('Hermes 바이트코드 컴파일');
  const hermesc = resolveHermesc(project);
  await run(hermesc, ['-emit-binary', '-max-diagnostic-width=80', '-w', '-O', '-output-source-map', '-out', bundleFile, packagerBundle]);

  // Metro 소스맵과 Hermes 소스맵을 합쳐 크래시 위치를 원본 TS로 되돌릴 수 있게 한다.
  await run(node, [
    path.join(project.reactNativePath, 'scripts', 'compose-source-maps.js'),
    packagerSourcemap,
    `${bundleFile}.map`,
    '-o',
    sourcemapFile,
  ]);

  await rm(packagerBundle, { force: true });
  await rm(packagerSourcemap, { force: true });
  await rm(`${bundleFile}.map`, { force: true });

  return { dir: outDir, bundleFile, assetsDir, sourcemapFile };
}
