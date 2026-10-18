import { fileURLToPath } from 'node:url';
import path from 'node:path';

// dist/utils/assets.js 기준으로 패키지 루트의 assets 디렉터리를 찾는다.
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export function assetPath(...segments: string[]): string {
  return path.join(packageRoot, 'assets', ...segments);
}

export function packagePath(...segments: string[]): string {
  return path.join(packageRoot, ...segments);
}
