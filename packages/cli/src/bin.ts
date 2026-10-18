#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Command } from 'commander';
import { loadConfig } from './config.js';
import { resolveRNProject } from './project.js';
import { bundle, type Platform } from './commands/bundle.js';
import { buildIOS } from './commands/build-ios.js';
import { buildAndroid } from './commands/build-android.js';
import { generateSources, writeGeneratedSources } from './codegen/index.js';
import { doctor } from './commands/doctor.js';
import { init } from './commands/init.js';
import { packagePath } from './utils/assets.js';
import { log } from './utils/log.js';
import { run } from './utils/exec.js';

const version = JSON.parse(readFileSync(packagePath('package.json'), 'utf8')).version;

async function loadProject(projectRoot: string) {
  const root = path.resolve(projectRoot);
  const project = resolveRNProject(root);
  const config = await loadConfig(root, project.packageVersion);
  return { project, config };
}

function action<Args extends unknown[]>(handler: (...args: Args) => Promise<void>) {
  return async (...args: Args) => {
    try {
      await handler(...args);
    } catch (error) {
      log.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  };
}

const program = new Command('nativepiece').version(version).description('React Native를 네이티브 앱용 모듈로 만들어요.');

program
  .command('bundle')
  .description('JS 번들과 assets를 만들어요')
  .argument('<platform>', 'ios | android')
  .option('--project-root <path>', 'RN 프로젝트 경로', '.')
  .action(
    action(async (platform: string, options: { projectRoot: string }) => {
      if (platform !== 'ios' && platform !== 'android') throw new Error(`지원하지 않는 플랫폼이에요: ${platform}`);
      const { project, config } = await loadProject(options.projectRoot);
      const output = await bundle(config, project, platform as Platform);
      log.success(`번들을 만들었어요: ${output.bundleFile}`);
    }),
  );

program
  .command('init')
  .description('기존 RN 앱을 Nativepiece 모듈로 만들 수 있게 설정해요')
  .option('--project-root <path>', 'RN 프로젝트 경로', '.')
  .option('-y, --yes', '확인 없이 진행해요')
  .action(
    action(async (options: { projectRoot: string; yes?: boolean }) => {
      await init(resolveRNProject(path.resolve(options.projectRoot)), options);
    }),
  );

program
  .command('doctor')
  .description('모듈 프로젝트와 개발 환경을 점검해요')
  .option('--project-root <path>', 'RN 프로젝트 경로', '.')
  .action(
    action(async (options: { projectRoot: string }) => {
      const ok = await doctor(resolveRNProject(path.resolve(options.projectRoot)));
      if (!ok) process.exitCode = 1;
    }),
  );

program
  .command('dev')
  .description('Metro 개발 서버를 띄워요. 호스트 앱에서 start(devServer:)로 연결해요')
  .option('--project-root <path>', 'RN 프로젝트 경로', '.')
  .option('--port <port>', 'Metro 포트', '8081')
  .action(
    action(async (options: { projectRoot: string; port: string }) => {
      const { project, config } = await loadProject(options.projectRoot);
      log.step(`Metro 시작 (진입점: ${config.entry}, 포트: ${options.port})`);
      log.info('Android 에뮬레이터는 `adb reverse tcp:8081 tcp:8081` 없이도 10.0.2.2로 연결돼요.');
      await run(process.execPath, [path.join(project.reactNativePath, 'cli.js'), 'start', '--port', options.port], {
        cwd: project.root,
      });
    }),
  );

program
  .command('codegen')
  .description('계약 파일(nativepiece.contract.ts)에서 Swift·Kotlin 코드를 만들어요')
  .option('--project-root <path>', 'RN 프로젝트 경로', '.')
  .action(
    action(async (options: { projectRoot: string }) => {
      const { config } = await loadProject(options.projectRoot);
      const outDir = await writeGeneratedSources(config, generateSources(config));
      log.success(`코드를 만들었어요: ${outDir}`);
    }),
  );

program
  .command('build')
  .description('플랫폼별 모듈 결과물을 만들어요')
  .argument('<platform>', 'ios | android')
  .option('--project-root <path>', 'RN 프로젝트 경로', '.')
  .option('--force', '캐시를 쓰지 않고 네이티브 빌드를 다시 해요')
  .option('--force-pod-install', 'pod install을 다시 실행해요')
  .option('--dev', 'Metro 개발 서버를 쓸 수 있는 개발용 결과물을 만들어요 (iOS)')
  .action(
    action(async (platform: string, options: { projectRoot: string; force?: boolean; forcePodInstall?: boolean; dev?: boolean }) => {
      const { project, config } = await loadProject(options.projectRoot);
      if (platform === 'ios') {
        await buildIOS(config, project, options);
      } else if (platform === 'android') {
        await buildAndroid(config, project);
      } else {
        throw new Error(`지원하지 않는 플랫폼이에요: ${platform}`);
      }
    }),
  );

await program.parseAsync();
