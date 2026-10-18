import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

// 입력 파일과 값으로 캐시 키를 만든다. 없는 파일도 키에 포함해 추가·삭제를 감지한다.
export class Fingerprint {
  private readonly hash = createHash('sha256');

  constructor(namespace: string) {
    this.hash.update(`${namespace}\n`);
  }

  value(key: string, value: string | number | boolean | null | undefined): this {
    this.hash.update(`${key}=${String(value)}\n`);
    return this;
  }

  file(filePath: string): this {
    if (existsSync(filePath)) {
      this.hash.update(`file ${filePath}\n`);
      this.hash.update(readFileSync(filePath));
    } else {
      this.hash.update(`missing ${filePath}\n`);
    }
    return this;
  }

  digest(): string {
    return this.hash.digest('hex');
  }
}
