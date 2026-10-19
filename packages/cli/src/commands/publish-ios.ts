import { existsSync, readFileSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { ResolvedConfig } from '../config.js';
import type { RNProject } from '../project.js';
import { workspaceDir } from '../project.js';
import { PACKAGE_MANIFEST, renderPackageSwift, type PackageManifest } from '../ios/package.js';
import { run } from '../utils/exec.js';
import { log } from '../utils/log.js';

export interface PublishIOSOptions {
  repo?: string;
  dryRun?: boolean;
}

interface BinaryAsset {
  name: string;
  file: string;
  checksum: string;
}

function assetName(framework: string): string {
  return `${framework}.xcframework.zip`;
}

// SwiftPM binaryTarget은 xcframework가 루트에 든 zip과 그 checksum을 요구한다.
async function zipFrameworks(packageDir: string, names: string[], outDir: string): Promise<BinaryAsset[]> {
  const assets: BinaryAsset[] = [];
  for (const name of names) {
    const file = path.join(outDir, assetName(name));
    await run('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', path.join(packageDir, 'Frameworks', `${name}.xcframework`), file]);
    const checksum = (await run('swift', ['package', 'compute-checksum', file], { inherit: false })).trim();
    assets.push({ name, file, checksum });
  }
  return assets;
}

function renderReadme(config: ResolvedConfig, repo: string): string {
  return `# ${config.name} (iOS)

[Nativepiece](https://github.com/team-PopPang/Nativepiece)로 만든 React Native 모듈의 Swift Package예요. 이 레포는 \`nativepiece publish ios\`가 만들어요. 직접 고치지 마세요.

\`\`\`swift
.package(url: "https://github.com/${repo}", exact: "${config.version}")
\`\`\`

바이너리는 이 레포의 GitHub Release에 있어요. 레포가 비공개라면 Xcode가 바이너리를 받을 수 있게 \`~/.netrc\`에 읽기 권한 토큰을 넣어 주세요.

\`\`\`
machine api.github.com
  login x-access-token
  password <GitHub 토큰>
\`\`\`
`;
}

async function stagePackage(
  config: ResolvedConfig,
  packageDir: string,
  stageDir: string,
  repo: string,
  manifest: PackageManifest,
  binary: (name: string) => string,
) {
  await writeFile(path.join(stageDir, 'Package.swift'), renderPackageSwift(config, manifest, binary));
  await cp(path.join(packageDir, 'Sources'), path.join(stageDir, 'Sources'), { recursive: true });
  await writeFile(path.join(stageDir, 'README.md'), renderReadme(config, repo));
  await writeFile(path.join(stageDir, '.gitignore'), '.build/\n.swiftpm/\n');
}

async function draftAssetIds(repo: string, version: string): Promise<Map<string, number>> {
  const json = await run('gh', ['api', `repos/${repo}/releases`, '--jq', `[.[] | select(.tag_name == "${version}" and .draft)][0].assets`], {
    inherit: false,
  });
  const assets = JSON.parse(json) as { id: number; name: string }[] | null;
  if (!assets?.length) throw new Error(`${repo}의 ${version} draft release에서 asset을 찾지 못했어요.`);
  return new Map(assets.map((asset) => [asset.name, asset.id]));
}

async function tagExists(repo: string, tag: string): Promise<boolean> {
  try {
    await run('gh', ['api', `repos/${repo}/git/ref/tags/${tag}`], { inherit: false });
    return true;
  } catch {
    return false;
  }
}

// 배포 레포의 내용을 이번 버전의 Package.swift와 소스로 바꾸고, 버전 태그를 붙여 푸시한다.
async function pushPackageRepository(repo: string, version: string, stageDir: string) {
  const cloneDir = await mkdtemp(path.join(os.tmpdir(), 'nativepiece-publish-'));
  try {
    await run('gh', ['repo', 'clone', repo, cloneDir, '--', '--quiet'], { inherit: false });
    for (const entry of await readdir(cloneDir)) {
      if (entry !== '.git') await rm(path.join(cloneDir, entry), { recursive: true, force: true });
    }
    await cp(stageDir, cloneDir, { recursive: true });

    const git = (...args: string[]) => run('git', ['-C', cloneDir, ...args], { inherit: false });
    const branch = (await git('symbolic-ref', '--short', 'HEAD').catch(() => 'main\n')).trim() || 'main';
    await git('add', '-A');
    await git('commit', '-m', `Release ${version}`);
    await git('tag', version);
    await git('push', 'origin', `HEAD:${branch}`);
    await git('push', 'origin', version);
  } finally {
    await rm(cloneDir, { recursive: true, force: true });
  }
}

export async function publishIOS(config: ResolvedConfig, project: RNProject, options: PublishIOSOptions): Promise<void> {
  const repo = options.repo ?? config.publish?.ios?.repo;
  if (!repo) throw new Error('배포 레포가 없어요. --repo owner/name을 넘기거나 nativepiece.config.ts에 publish.ios.repo를 넣어 주세요.');

  const packageDir = workspaceDir(project.root, 'output', 'ios', config.name);
  const manifestPath = path.join(packageDir, PACKAGE_MANIFEST);
  if (!existsSync(manifestPath)) {
    throw new Error(`배포할 Swift Package가 없어요. 먼저 \`nativepiece build ios\`를 실행해 주세요: ${packageDir}`);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as PackageManifest;
  const version = config.version;

  if (!options.dryRun && (await tagExists(repo, version))) {
    throw new Error(`${repo}에 ${version} 태그가 이미 있어요. 배포한 버전은 덮어쓰지 않아요. 버전을 올려 주세요.`);
  }

  const publishDir = workspaceDir(project.root, 'publish', 'ios', version);
  const assetsDir = path.join(publishDir, 'assets');
  const stageDir = path.join(publishDir, 'package');
  await rm(publishDir, { recursive: true, force: true });
  await mkdir(assetsDir, { recursive: true });
  await mkdir(stageDir, { recursive: true });

  log.step('XCFramework 압축과 checksum 계산');
  const assets = await zipFrameworks(packageDir, manifest.names, assetsDir);
  const byName = new Map(assets.map((asset) => [asset.name, asset]));

  if (options.dryRun) {
    await stagePackage(config, packageDir, stageDir, repo, manifest, (name) => {
      const asset = byName.get(name)!;
      return `url: "https://github.com/${repo}/releases/download/${version}/${assetName(name)}", checksum: "${asset.checksum}"`;
    });
    log.success(`배포할 내용을 만들었어요 (dry run): ${publishDir}`);
    return;
  }

  // 태그를 푸시하기 전에 바이너리를 Draft Release로 먼저 올린다. 비공개 레포는 asset ID가 들어간 API 주소를 써야 해서다.
  log.step('GitHub Release(draft)에 XCFramework 올리기');
  await run('gh', [
    'release',
    'create',
    version,
    '--repo',
    repo,
    '--draft',
    '--title',
    `${config.name} ${version}`,
    '--notes',
    `Built with Nativepiece. \`.package(url: "https://github.com/${repo}", exact: "${version}")\``,
    ...assets.map((asset) => asset.file),
  ]);

  const isPrivate = (await run('gh', ['repo', 'view', repo, '--json', 'visibility', '--jq', '.visibility'], { inherit: false })).trim() !== 'PUBLIC';
  const assetIds = isPrivate ? await draftAssetIds(repo, version) : new Map<string, number>();

  log.step('원격용 Package.swift 생성');
  await stagePackage(config, packageDir, stageDir, repo, manifest, (name) => {
    const asset = byName.get(name)!;
    // 비공개 레포의 일반 다운로드 주소는 토큰을 넣어도 404라서 API 주소를 쓴다. 공개 레포는 요청 제한이 없는 일반 주소를 쓴다.
    const url = isPrivate
      ? `https://api.github.com/repos/${repo}/releases/assets/${assetIds.get(assetName(name))}.zip`
      : `https://github.com/${repo}/releases/download/${version}/${assetName(name)}`;
    return `url: "${url}", checksum: "${asset.checksum}"`;
  });

  log.step(`${repo}에 ${version} 푸시`);
  await pushPackageRepository(repo, version, stageDir);

  log.step('GitHub Release 공개');
  await run('gh', ['release', 'edit', version, '--repo', repo, '--draft=false'], { inherit: false });

  log.success(`배포했어요: https://github.com/${repo}/releases/tag/${version}`);
  log.info(`.package(url: "https://github.com/${repo}", exact: "${version}")`);
}
