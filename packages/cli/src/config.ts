import { existsSync } from 'node:fs';
import path from 'node:path';
import { createJiti } from 'jiti';
import { z } from 'zod';

const CONFIG_FILE_NAMES = [
  'nativepiece.config.ts',
  'nativepiece.config.mts',
  'nativepiece.config.js',
  'nativepiece.config.mjs',
];

// Swift 모듈 이름과 Kotlin 클래스 접두사로 그대로 쓰이므로 식별자 규칙을 강제한다.
const identifier = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9]*$/, '영문자로 시작하는 영문자·숫자 조합이어야 해요');

const semver = z
  .string()
  .regex(/^\d+\.\d+\.\d+([.-][0-9A-Za-z.-]+)?$/, 'x.y.z 형식의 버전이어야 해요');

const osVersion = z.string().regex(/^\d+(\.\d+){1,2}$/, '예: 17.0');

const androidAbi = z.enum(['arm64-v8a', 'armeabi-v7a', 'x86', 'x86_64']);

const configSchema = z.object({
  name: identifier,
  version: semver.optional(),
  entry: z.string().default('nativepiece.entry.ts'),
  contract: z.string().default('nativepiece.contract.ts'),
  bundler: z.enum(['metro']).default('metro'),
  hermes: z
    .object({
      bytecode: z.boolean().default(true),
    })
    .default({ bytecode: true }),
  ios: z
    .object({
      deploymentTarget: osVersion.default('17.0'),
      useRNPrebuilts: z.boolean().default(true),
      stripSimulatorDebugSymbols: z.boolean().default(true),
    })
    .default({
      deploymentTarget: '17.0',
      useRNPrebuilts: true,
      stripSimulatorDebugSymbols: true,
    }),
  android: z
    .object({
      group: z.string().regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/, '예: com.example'),
      artifactId: z.string().regex(/^[a-z][a-z0-9-]*$/).optional(),
      namespace: z.string().regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/).optional(),
      minSdk: z.number().int().min(24).optional(),
      compileSdk: z.number().int().optional(),
      abis: z.array(androidAbi).nonempty().default(['arm64-v8a', 'x86_64']),
      // true면 Jetpack Compose용 artifact(<artifactId>-compose)를 함께 발행한다.
      compose: z.boolean().default(true),
    })
    .optional(),
});

export type NativepieceUserConfig = z.input<typeof configSchema>;

export interface ResolvedConfig {
  name: string;
  version: string;
  entry: string;
  contract: string;
  bundler: 'metro';
  hermes: { bytecode: boolean };
  ios: {
    deploymentTarget: string;
    useRNPrebuilts: boolean;
    stripSimulatorDebugSymbols: boolean;
  };
  android: {
    group: string;
    artifactId: string;
    namespace: string;
    minSdk?: number;
    compileSdk?: number;
    abis: string[];
    compose: boolean;
  } | null;
  projectRoot: string;
  configPath: string;
}

export function defineConfig(config: NativepieceUserConfig): NativepieceUserConfig {
  return config;
}

export function findConfigPath(projectRoot: string): string | null {
  for (const fileName of CONFIG_FILE_NAMES) {
    const candidate = path.join(projectRoot, fileName);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

// 설정 파일을 읽고 기본값을 채운다. 잘못된 값은 빌드를 시작하기 전에 한 번에 보고한다.
export async function loadConfig(projectRoot: string, packageVersion: string): Promise<ResolvedConfig> {
  const configPath = findConfigPath(projectRoot);
  if (!configPath) {
    throw new Error(
      `nativepiece.config.ts를 찾지 못했어요: ${projectRoot}\n` +
        '`npx nativepiece init`으로 만들 수 있어요.',
    );
  }

  const jiti = createJiti(import.meta.url, { interopDefault: true });
  const loaded = await jiti.import(configPath, { default: true });

  const parsed = configSchema.safeParse(loaded);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`설정 파일이 올바르지 않아요: ${configPath}\n${issues}`);
  }

  const config = parsed.data;
  const kebabName = config.name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

  return {
    name: config.name,
    version: config.version ?? packageVersion,
    entry: config.entry,
    contract: config.contract,
    bundler: config.bundler,
    hermes: config.hermes,
    ios: config.ios,
    android: config.android
      ? {
          group: config.android.group,
          artifactId: config.android.artifactId ?? `${kebabName}-android`,
          namespace: config.android.namespace ?? `${config.android.group}.${config.name.toLowerCase()}`,
          minSdk: config.android.minSdk,
          compileSdk: config.android.compileSdk,
          abis: [...config.android.abis],
          compose: config.android.compose,
        }
      : null,
    projectRoot,
    configPath,
  };
}
