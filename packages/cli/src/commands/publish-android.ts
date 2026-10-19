import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ResolvedConfig } from '../config.js';
import type { RNProject } from '../project.js';
import { workspaceDir } from '../project.js';
import { run } from '../utils/exec.js';
import { log } from '../utils/log.js';

export interface PublishAndroidOptions {
  url?: string;
  dryRun?: boolean;
}

interface Credentials {
  username: string;
  password: string;
}

async function listFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  const walk = async (dir: string) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(fullPath);
      else files.push(fullPath);
    }
  };
  await walk(root);
  return files.sort();
}

// 환경 변수가 없고 GitHub Packages로 올리면 gh 로그인 정보를 쓴다. 토큰에 write:packages 권한이 있어야 한다.
async function resolveCredentials(url: string): Promise<Credentials> {
  const username = process.env.NATIVEPIECE_MAVEN_USERNAME;
  const password = process.env.NATIVEPIECE_MAVEN_PASSWORD;
  if (username && password) return { username, password };

  if (new URL(url).hostname === 'maven.pkg.github.com') {
    const token = (await run('gh', ['auth', 'token'], { inherit: false })).trim();
    const login = (await run('gh', ['api', 'user', '--jq', '.login'], { inherit: false })).trim();
    return { username: login, password: token };
  }
  throw new Error('Maven 저장소 인증 정보가 없어요. NATIVEPIECE_MAVEN_USERNAME, NATIVEPIECE_MAVEN_PASSWORD를 설정해 주세요.');
}

function authorization({ username, password }: Credentials): string {
  return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
}

// 로컬 Maven 저장소의 버전 디렉터리(group/artifact/version)를 찾는다. maven-metadata.xml은 원격 저장소가 관리한다.
async function versionDirectories(repositoryDir: string): Promise<string[]> {
  const poms = (await listFiles(repositoryDir)).filter((file) => file.endsWith('.pom'));
  return [...new Set(poms.map((pom) => path.dirname(pom)))];
}

export async function publishAndroid(config: ResolvedConfig, project: RNProject, options: PublishAndroidOptions): Promise<void> {
  if (!config.android) throw new Error('nativepiece.config.ts에 android 설정이 필요해요.');
  const url = (options.url ?? config.publish?.android?.url)?.replace(/\/$/, '');
  if (!url) throw new Error('Maven 저장소 주소가 없어요. --url을 넘기거나 nativepiece.config.ts에 publish.android.url을 넣어 주세요.');

  const repositoryDir = workspaceDir(project.root, 'output', 'android', 'maven');
  if (!existsSync(repositoryDir)) {
    throw new Error(`배포할 Maven 저장소가 없어요. 먼저 \`nativepiece build android\`를 실행해 주세요: ${repositoryDir}`);
  }

  // 네이티브 모듈 AAR을 먼저 올리고 SDK를 마지막에 올린다. 중간에 실패해도 SDK가 없는 의존성을 가리키지 않게 하려는 것이다.
  const sdkPrefix = path.join(...config.android.group.split('.'), config.android.artifactId);
  const isSdk = (directory: string) => path.relative(repositoryDir, directory).startsWith(sdkPrefix);
  const directories = (await versionDirectories(repositoryDir)).sort((a, b) => Number(isSdk(a)) - Number(isSdk(b)));
  const credentials = options.dryRun ? null : await resolveCredentials(url);

  for (const directory of directories) {
    const coordinate = path.relative(repositoryDir, directory);
    const files = (await readdir(directory)).filter((name) => !name.startsWith('maven-metadata'));
    const pom = files.find((name) => name.endsWith('.pom'))!;

    if (options.dryRun) {
      log.info(`${coordinate} (${files.length}개 파일)`);
      continue;
    }

    // 이미 있는 버전은 건너뛴다. 네이티브 모듈 AAR은 모듈 버전이 같으면 내용도 같고, SDK는 버전을 올려야 한다.
    const head = await fetch(`${url}/${coordinate}/${pom}`, { method: 'HEAD', headers: { Authorization: authorization(credentials!) } });
    if (head.ok) {
      if (isSdk(directory)) {
        throw new Error(`${coordinate}이(가) 이미 있어요. 배포한 버전은 덮어쓰지 않아요. 버전을 올려 주세요.`);
      }
      log.info(`이미 있어서 건너뛰어요: ${coordinate}`);
      continue;
    }

    log.step(`올리기: ${coordinate}`);
    for (const name of files) {
      const response = await fetch(`${url}/${coordinate}/${name}`, {
        method: 'PUT',
        headers: { Authorization: authorization(credentials!) },
        body: await readFile(path.join(directory, name)),
      });
      if (!response.ok) {
        const detail = (await response.text()).slice(0, 300);
        throw new Error(`${coordinate}/${name}을(를) 올리지 못했어요 (${response.status}): ${detail}`);
      }
    }
  }

  if (options.dryRun) {
    log.success(`올릴 artifact ${directories.length}개를 확인했어요 (dry run): ${url}`);
    return;
  }

  log.success(`배포했어요: ${url}`);
  log.info(`implementation("${config.android.group}:${config.android.artifactId}:${config.version}")`);
}
