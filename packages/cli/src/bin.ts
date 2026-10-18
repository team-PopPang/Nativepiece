#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Command } from 'commander';
import { loadConfig } from './config.js';
import { resolveRNProject } from './project.js';
import { bundle, type Platform } from './commands/bundle.js';
import { buildIOS } from './commands/build-ios.js';
import { buildAndroid } from './commands/build-android.js';
import { packagePath } from './utils/assets.js';
import { log } from './utils/log.js';

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
  .command('build')
  .description('플랫폼별 모듈 결과물을 만들어요')
  .argument('<platform>', 'ios | android')
  .option('--project-root <path>', 'RN 프로젝트 경로', '.')
  .option('--force', '캐시를 쓰지 않고 네이티브 빌드를 다시 해요')
  .option('--force-pod-install', 'pod install을 다시 실행해요')
  .action(
    action(async (platform: string, options: { projectRoot: string; force?: boolean; forcePodInstall?: boolean }) => {
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
