// 호스트 SDK 소스는 결과물에 소스로 들어가므로 CLI 패키지 assets에 함께 담는다.
import { cp, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const cliRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packagesRoot = path.resolve(cliRoot, '..');

for (const host of ['ios-host', 'android-host']) {
  const destination = path.join(cliRoot, 'assets', host);
  await rm(destination, { recursive: true, force: true });
  await cp(path.join(packagesRoot, host), destination, { recursive: true });
}
