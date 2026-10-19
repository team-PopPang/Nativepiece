#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { chmod, copyFile, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import pc from 'picocolors';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const templateDir = path.join(packageRoot, 'template');
const version = JSON.parse(readFileSync(path.join(packageRoot, 'package.json'), 'utf8')).version as string;

// 이름을 바꾸지 않고 그대로 복사하는 파일이다.
const BINARY_FILES = new Set(['gradle-wrapper.jar']);
const EXECUTABLE_FILES = new Set(['gradlew']);

// Nativepiece CI에서 빌드와 실행을 검증한 RN 버전이다. 템플릿 package.json의 기본 버전이기도 하다.
const TESTED_RN_VERSIONS = ['0.84', '0.85', '0.86', '0.87', '0.88'];
// prebuilt core와 New Architecture가 기본인 버전부터 지원한다.
const MIN_RN_VERSION = [0, 84];

// 템플릿 package.json에서 공식 RN 템플릿의 버전으로 바꿀 의존성이다. 나머지는 Nativepiece 템플릿 값을 그대로 쓴다.
const RN_MANAGED_DEPENDENCIES = [
  'react',
  'react-native',
  '@babel/core',
  '@babel/preset-env',
  '@babel/runtime',
  '@react-native-community/cli',
  '@react-native-community/cli-platform-android',
  '@react-native-community/cli-platform-ios',
  '@react-native/babel-preset',
  '@react-native/metro-config',
  '@react-native/typescript-config',
  '@types/react',
  'typescript',
];

interface Options {
  rn?: string;
  name?: string;
  group: string;
  iosTarget: string;
  install: boolean;
  nativepiece?: string;
}

function pascalCase(value: string): string {
  return value
    .replace(/[^A-Za-z0-9]+(.)?/g, (_, next: string | undefined) => (next ? next.toUpperCase() : ''))
    .replace(/^./, (first) => first.toUpperCase());
}

function kebabCase(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/[^A-Za-z0-9]+/g, '-').toLowerCase();
}

function run(command: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit' });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${command} ${args.join(' ')} 실패 (exit ${code})`))));
  });
}

function capture(command: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'inherit'] });
    let output = '';
    child.stdout.on('data', (chunk) => (output += chunk));
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve(output) : reject(new Error(`${command} ${args.join(' ')} 실패 (exit ${code})`))));
  });
}

// 공식 RN 앱 템플릿(@react-native-community/template)의 template/package.json에서 그 RN 버전에 맞는 의존성 버전을 읽는다.
async function officialTemplateVersions(range: string): Promise<{ version: string; versions: Record<string, string> }> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'create-nativepiece-'));
  try {
    const versions = JSON.parse(await capture('npm', ['view', `@react-native-community/template@${range}`, 'version', '--json'], tempDir));
    const version = Array.isArray(versions) ? versions.at(-1) : versions;
    if (!version) throw new Error(`React Native ${range} 템플릿을 찾지 못했어요.`);
    const tarball = (await capture('npm', ['pack', `@react-native-community/template@${version}`, '--silent'], tempDir)).trim().split('\n').at(-1)!;
    const packageJson = JSON.parse(await capture('tar', ['-xOzf', tarball, 'package/template/package.json'], tempDir));
    return { version, versions: { ...packageJson.devDependencies, ...packageJson.dependencies } };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function applyReactNativeVersion(root: string, range: string) {
  const { version, versions } = await officialTemplateVersions(range);
  const [major, minor] = version.split('.').map(Number);
  if (major < MIN_RN_VERSION[0] || (major === MIN_RN_VERSION[0] && minor < MIN_RN_VERSION[1])) {
    throw new Error(`React Native ${version}은 지원하지 않아요. ${MIN_RN_VERSION.join('.')} 이상이 필요해요.`);
  }
  if (!TESTED_RN_VERSIONS.includes(`${major}.${minor}`)) {
    console.warn(`${pc.yellow('!')} React Native ${version}은 Nativepiece에서 아직 검증하지 않은 버전이에요 (검증: ${TESTED_RN_VERSIONS.join(', ')}).`);
  }

  const packageJsonPath = path.join(root, 'package.json');
  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'));
  for (const field of ['dependencies', 'devDependencies'] as const) {
    for (const name of Object.keys(packageJson[field] ?? {})) {
      if (RN_MANAGED_DEPENDENCIES.includes(name) && versions[name]) packageJson[field][name] = versions[name];
    }
  }
  await writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);
  console.log(`${pc.cyan('▸')} React Native ${version}`);
}

function readToml(file: string): Map<string, string> {
  const values = new Map<string, string>();
  if (!existsSync(file)) return values;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const match = line.match(/^\s*([A-Za-z0-9_-]+)\s*=\s*"([^"]*)"/);
    if (match) values.set(match[1], match[2]);
  }
  return values;
}

// 예제 Android 앱의 AGP·Kotlin·compileSdk·Gradle 버전을 설치된 RN이 요구하는 값으로 맞춘다.
// 예를 들어 RN 0.88의 라이브러리는 compileSdk 37과 AGP 9를 요구한다.
async function syncExampleAndroidVersions(root: string) {
  const reactNative = path.join(root, 'node_modules', 'react-native');
  const gradlePlugin = path.join(root, 'node_modules', '@react-native', 'gradle-plugin');
  const rnVersions = readToml(path.join(reactNative, 'gradle', 'libs.versions.toml'));
  const pluginVersions = readToml(path.join(gradlePlugin, 'gradle', 'libs.versions.toml'));
  const agp = pluginVersions.get('agp');
  const kotlin = pluginVersions.get('kotlin');
  const compileSdk = rnVersions.get('compileSdk');
  const targetSdk = rnVersions.get('targetSdk');
  if (!agp || !kotlin || !compileSdk || !targetSdk) {
    console.warn(`${pc.yellow('!')} RN의 Android 버전 정보를 찾지 못해서 예제 Android 앱 버전을 그대로 둬요.`);
    return;
  }

  const example = path.join(root, 'example', 'android');
  const rootBuild = path.join(example, 'build.gradle');
  await writeFile(
    rootBuild,
    (await readFile(rootBuild, 'utf8'))
      .replace(/(id "com\.android\.application" version ")[^"]+"/, `$1${agp}"`)
      .replace(/(id "org\.jetbrains\.kotlin\.android" version ")[^"]+"/, `$1${kotlin}"`)
      .replace(/(id "org\.jetbrains\.kotlin\.plugin\.compose" version ")[^"]+"/, `$1${kotlin}"`),
  );
  const appBuild = path.join(example, 'app', 'build.gradle');
  await writeFile(
    appBuild,
    (await readFile(appBuild, 'utf8')).replace(/compileSdk \d+/, `compileSdk ${compileSdk}`).replace(/targetSdk \d+/, `targetSdk ${targetSdk}`),
  );

  const pluginWrapper = path.join(gradlePlugin, 'gradle', 'wrapper', 'gradle-wrapper.properties');
  const distributionUrl = existsSync(pluginWrapper) ? readFileSync(pluginWrapper, 'utf8').match(/^distributionUrl=.+$/m)?.[0] : undefined;
  if (distributionUrl) {
    const wrapper = path.join(example, 'gradle', 'wrapper', 'gradle-wrapper.properties');
    await writeFile(wrapper, (await readFile(wrapper, 'utf8')).replace(/^distributionUrl=.+$/m, distributionUrl));
  }
}

async function copyTemplate(source: string, destination: string, values: Record<string, string>) {
  await mkdir(destination, { recursive: true });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    // npm은 .gitignore와 .npmrc를 패키지에 넣지 않아서 다른 이름으로 담아 두고 복사할 때 바꾼다.
    const name = entry.name === '_gitignore' ? '.gitignore' : entry.name === '_npmrc' ? '.npmrc' : entry.name;
    const target = path.join(destination, name === '__androidPackagePath__' ? values.androidPackagePath : name);
    const from = path.join(source, entry.name);

    if (entry.isDirectory()) {
      await copyTemplate(from, target, values);
    } else if (BINARY_FILES.has(entry.name)) {
      await copyFile(from, target);
    } else {
      const content = (await readFile(from, 'utf8')).replace(/\{\{(\w+)\}\}/g, (match, key: string) => values[key] ?? match);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, content);
      if (EXECUTABLE_FILES.has(entry.name)) await chmod(target, 0o755);
    }
  }
}

async function create(directory: string, options: Options) {
  const root = path.resolve(directory);
  if (existsSync(root) && (await readdir(root)).length > 0) {
    throw new Error(`비어 있지 않은 폴더예요: ${root}`);
  }

  const name = options.name ?? pascalCase(path.basename(root));
  if (!/^[A-Za-z][A-Za-z0-9]*$/.test(name)) {
    throw new Error(`모듈 이름은 영문자로 시작하는 영문자·숫자 조합이어야 해요: ${name}`);
  }
  if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(options.group)) {
    throw new Error(`group은 com.example 같은 형식이어야 해요: ${options.group}`);
  }

  const androidPackage = `${options.group}.${name.toLowerCase()}`;
  // npm 배포 전에는 로컬 Nativepiece 레포의 패키지를 복사해서 설치한다.
  const local = options.nativepiece ? path.resolve(options.nativepiece, 'packages') : null;
  const values: Record<string, string> = {
    name,
    packageName: kebabCase(path.basename(root)),
    group: options.group,
    androidPackage,
    androidPackagePath: androidPackage.split('.').join(path.sep),
    artifactId: `${kebabCase(name)}-android`,
    iosBundleId: options.group,
    iosDeploymentTarget: options.iosTarget,
    runtimeVersion: local ? `file:${path.join(local, 'runtime')}` : `^${version}`,
    cliVersion: local ? `file:${path.join(local, 'cli')}` : `^${version}`,
  };

  console.log(`${pc.cyan('▸')} ${pc.bold(name)} 모듈을 만들어요: ${root}`);
  await copyTemplate(templateDir, root, values);
  if (options.rn) await applyReactNativeVersion(root, options.rn);

  if (options.install) {
    console.log(`${pc.cyan('▸')} 의존성 설치`);
    await run('npm', local ? ['install', '--install-links'] : ['install'], root);
    await syncExampleAndroidVersions(root);
  } else if (options.rn) {
    console.warn(`${pc.yellow('!')} --no-install이라 예제 Android 앱의 Gradle 버전을 RN ${options.rn}에 맞추지 못했어요.`);
  }

  const relative = path.relative(process.cwd(), root) || '.';
  console.log(`\n${pc.green('✔')} 만들었어요.\n`);
  console.log(pc.bold('다음 단계'));
  console.log(`  cd ${relative}`);
  if (!options.install) console.log('  npm install');
  console.log('  npm run doctor');
  console.log('  npm run build:ios      # 그다음 example/ios/ExampleHost.xcodeproj 실행');
  console.log('  npm run build:android  # 그다음 example/android를 Android Studio로 실행');
}

const program = new Command('create-nativepiece')
  .usage('<directory> [options]  (npm init @team-poppang/nativepiece <directory>)')
  .version(version)
  .description('Swift Package와 Android AAR로 빌드할 수 있는 React Native 모듈 앱을 만들어요.')
  .argument('<directory>', '만들 폴더')
  .option('--name <name>', '모듈 이름 (Swift 모듈·Kotlin 객체 이름). 기본값은 폴더 이름의 PascalCase')
  .option('--group <group>', 'Android Maven groupId이자 iOS bundle id 접두사', 'com.example')
  .option('--ios-target <version>', 'iOS 최소 버전', '17.0')
  .option('--rn <version>', `React Native 버전 (예: 0.88). 기본값은 검증한 버전(${TESTED_RN_VERSIONS.join(', ')})이에요`)
  .option('--no-install', '의존성을 설치하지 않아요')
  .option('--nativepiece <path>', '(개발용) 로컬 Nativepiece 레포의 패키지를 써요')
  .action(async (directory: string, options: Options) => {
    try {
      await create(directory, options);
    } catch (error) {
      console.error(`${pc.red('✖')} ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    }
  });

await program.parseAsync();
