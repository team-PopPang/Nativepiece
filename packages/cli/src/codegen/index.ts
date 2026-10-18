import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ResolvedConfig } from '../config.js';
import { workspaceDir } from '../project.js';
import { renderKotlin } from './kotlin.js';
import { loadContract, type ContractModel } from './model.js';
import { renderSwift } from './swift.js';

export interface GeneratedSources {
  swift: string | null;
  kotlin: string;
  kotlinPackage: string;
}

const EMPTY_MODEL: ContractModel = { screens: [], events: [], calls: [], messages: [], objects: [], enums: [] };

export function contractPath(config: ResolvedConfig): string {
  return path.resolve(config.projectRoot, config.contract);
}

// 계약 파일에서 Swift·Kotlin 코드를 만든다. 계약 파일이 없으면 시작 API만 있는 Kotlin 코드를 만든다.
export function generateSources(config: ResolvedConfig): GeneratedSources {
  const file = contractPath(config);
  const model = existsSync(file) ? loadContract(file) : null;
  const kotlinPackage = config.android?.namespace ?? `io.nativepiece.${config.name.toLowerCase()}`;
  return {
    swift: model ? renderSwift(model, config.name, config.version) : null,
    kotlin: renderKotlin(model ?? EMPTY_MODEL, config.name, kotlinPackage, config.version),
    kotlinPackage,
  };
}

// 생성 결과를 확인할 수 있게 .nativepiece/codegen에 쓴다.
export async function writeGeneratedSources(config: ResolvedConfig, sources: GeneratedSources): Promise<string> {
  const outDir = workspaceDir(config.projectRoot, 'codegen');
  await mkdir(path.join(outDir, 'ios'), { recursive: true });
  await mkdir(path.join(outDir, 'android'), { recursive: true });
  if (sources.swift) await writeFile(path.join(outDir, 'ios', `${config.name}Contract.swift`), sources.swift);
  await writeFile(path.join(outDir, 'android', `${config.name}.kt`), sources.kotlin);
  return outDir;
}
