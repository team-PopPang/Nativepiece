import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

export interface RNProject {
  root: string;
  packageVersion: string;
  reactNativePath: string;
  reactNativeVersion: string;
}

// 모노레포에서도 동작하도록 node 모듈 해석 규칙으로 react-native 위치를 찾는다.
export function resolveRNProject(root: string): RNProject {
  const packageJsonPath = path.join(root, 'package.json');
  if (!existsSync(packageJsonPath)) {
    throw new Error(`package.json을 찾지 못했어요: ${root}`);
  }

  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
  const require = createRequire(packageJsonPath);

  let reactNativePackageJson: string;
  try {
    reactNativePackageJson = require.resolve('react-native/package.json');
  } catch {
    throw new Error('react-native를 찾지 못했어요. 먼저 의존성을 설치해 주세요 (npm ci).');
  }

  const reactNative = JSON.parse(readFileSync(reactNativePackageJson, 'utf8'));
  return {
    root,
    packageVersion: packageJson.version ?? '0.0.0',
    reactNativePath: path.dirname(reactNativePackageJson),
    reactNativeVersion: reactNative.version,
  };
}

export function workspaceDir(root: string, ...segments: string[]): string {
  return path.join(root, '.nativepiece', ...segments);
}
