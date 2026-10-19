#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { chmod, mkdir, readdir, readFile, writeFile, copyFile } from 'node:fs/promises';
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

interface Options {
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

async function copyTemplate(source: string, destination: string, values: Record<string, string>) {
  await mkdir(destination, { recursive: true });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const name = entry.name === '_gitignore' ? '.gitignore' : entry.name;
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

  if (options.install) {
    console.log(`${pc.cyan('▸')} 의존성 설치`);
    await run('npm', local ? ['install', '--install-links'] : ['install'], root);
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
  .version(version)
  .description('Swift Package와 Android AAR로 빌드할 수 있는 React Native 모듈 앱을 만들어요.')
  .argument('<directory>', '만들 폴더')
  .option('--name <name>', '모듈 이름 (Swift 모듈·Kotlin 객체 이름). 기본값은 폴더 이름의 PascalCase')
  .option('--group <group>', 'Android Maven groupId이자 iOS bundle id 접두사', 'com.example')
  .option('--ios-target <version>', 'iOS 최소 버전', '17.0')
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
