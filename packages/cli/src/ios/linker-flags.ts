import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { PREBUILD_TARGET } from './workspace.js';

export interface LinkerFlags {
  objc: boolean;
  libraries: string[];
  frameworks: string[];
  weakFrameworks: string[];
}

// xcconfig에서 key 값을 읽는다. 줄 끝의 "\"로 이어진 여러 줄 값도 합친다.
function readAssignment(content: string, key: string): string {
  const lines = content.split('\n');
  let value: string | null = null;
  for (const line of lines) {
    const trimmed = line.trim();
    if (value === null) {
      if (!trimmed.startsWith(`${key} =`)) continue;
      value = trimmed.slice(trimmed.indexOf('=') + 1).trim();
    } else {
      value += ` ${trimmed}`;
    }
    if (value.endsWith('\\')) {
      value = value.slice(0, -1).trimEnd();
      continue;
    }
    return value;
  }
  throw new Error(`${key}를 xcconfig에서 찾지 못했어요.`);
}

function tokenize(value: string): string[] {
  const tokens: string[] = [];
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
  for (const match of value.matchAll(pattern)) {
    tokens.push(match[1] ?? match[2] ?? match[3]);
  }
  return tokens;
}

// CocoaPods aggregate 타깃의 OTHER_LDFLAGS를 SwiftPM linkerSettings로 옮길 수 있게 분류한다.
// 패키지 안에 binary target으로 들어간 framework는 시스템 framework가 아니므로 제외한다.
export async function readLinkerFlags(workspaceDir: string, internalFrameworks: Set<string>): Promise<LinkerFlags> {
  const supportDir = path.join(workspaceDir, 'Pods', 'Target Support Files', `Pods-${PREBUILD_TARGET}`);
  const libraries = new Set<string>(['c++']);
  const frameworks = new Set<string>();
  const weakFrameworks = new Set<string>();
  let objc = false;

  for (const configuration of ['debug', 'release']) {
    const content = await readFile(path.join(supportDir, `Pods-${PREBUILD_TARGET}.${configuration}.xcconfig`), 'utf8');
    const tokens = tokenize(readAssignment(content, 'OTHER_LDFLAGS'));
    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index];
      if (token === '-ObjC') {
        objc = true;
      } else if (token.startsWith('-l') && token.length > 2) {
        libraries.add(token.slice(2));
      } else if (token === '-framework' || token === '-weak_framework') {
        const name = tokens[index + 1];
        index += 1;
        if (!name || internalFrameworks.has(name)) continue;
        (token === '-framework' ? frameworks : weakFrameworks).add(name);
      }
    }
  }

  for (const name of weakFrameworks) frameworks.delete(name);

  return {
    objc,
    libraries: [...libraries].sort(),
    frameworks: [...frameworks].sort(),
    weakFrameworks: [...weakFrameworks].sort(),
  };
}
