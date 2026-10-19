import { existsSync, readFileSync } from 'node:fs';
import { appendFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import pc from 'picocolors';
import ts from 'typescript';
import { findConfigPath } from '../config.js';
import { pascalCase } from '../codegen/model.js';
import type { RNProject } from '../project.js';
import { packagePath } from '../utils/assets.js';
import { log } from '../utils/log.js';
import { checkProject } from './doctor.js';

export interface InitOptions {
  yes?: boolean;
}

interface RegisteredScreen {
  // AppRegistry에 등록된 이름. 계약의 화면 이름은 이 값을 lowerCamelCase로 바꿔서 쓴다.
  appKey: string;
  screenName: string;
  componentName: string;
  importPath: string;
  isDefaultImport: boolean;
  sourceFile: string;
}

interface PlannedFile {
  path: string;
  description: string;
  apply(): Promise<void>;
}

const ENTRY_CANDIDATES = ['index.js', 'index.ts', 'index.tsx', 'native-entry.js', 'native-entry.ts', 'native-entry.tsx'];
const LEGACY_DIRECTORIES = ['react_native_prebuild', 'react_native_android_prebuild'];

function readJson(file: string) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

// 기존 진입점에서 AppRegistry.registerComponent('Name', () => Component) 호출과 Component의 import를 찾는다.
function findRegisteredScreens(project: RNProject): RegisteredScreen[] {
  const packageJson = readJson(path.join(project.root, 'package.json'));
  const candidates = new Set(ENTRY_CANDIDATES);
  if (typeof packageJson.main === 'string') candidates.add(packageJson.main);

  const screens: RegisteredScreen[] = [];
  for (const candidate of candidates) {
    const file = path.join(project.root, candidate);
    if (!existsSync(file)) continue;
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);

    const imports = new Map<string, { importPath: string; isDefault: boolean }>();
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
      const clause = statement.importClause;
      const importPath = statement.moduleSpecifier.text;
      if (clause?.name) imports.set(clause.name.text, { importPath, isDefault: true });
      if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        for (const element of clause.namedBindings.elements) imports.set(element.name.text, { importPath, isDefault: false });
      }
    }

    const visit = (node: ts.Node) => {
      if (
        ts.isCallExpression(node) &&
        node.expression.getText(source).endsWith('registerComponent') &&
        node.arguments.length >= 2
      ) {
        const [nameNode, factory] = node.arguments;
        const appKey = ts.isStringLiteral(nameNode) ? nameNode.text : null;
        const body = ts.isArrowFunction(factory) ? factory.body : null;
        const componentName = body && ts.isIdentifier(body) ? body.text : null;
        const imported = componentName ? imports.get(componentName) : undefined;
        if (appKey && componentName && imported) {
          const screenName = pascalCase(appKey).replace(/^./, (first) => first.toLowerCase());
          screens.push({
            appKey,
            screenName,
            componentName,
            importPath: imported.importPath,
            isDefaultImport: imported.isDefault,
            sourceFile: candidate,
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return screens;
}

function iosDeploymentTarget(project: RNProject): string {
  const podfile = path.join(project.root, 'ios', 'Podfile');
  const literal = existsSync(podfile) ? readFileSync(podfile, 'utf8').match(/platform\s+:ios,\s*['"]([0-9.]+)['"]/)?.[1] : undefined;
  if (literal) return literal;
  const helpers = path.join(project.reactNativePath, 'scripts', 'cocoapods', 'helpers.rb');
  const minimum = existsSync(helpers)
    ? readFileSync(helpers, 'utf8').match(/def self\.min_ios_version_supported\s+return '([0-9.]+)'/)?.[1]
    : undefined;
  return minimum ?? '15.1';
}

function androidGroup(project: RNProject): string {
  const buildGradle = ['build.gradle', 'build.gradle.kts']
    .map((file) => path.join(project.root, 'android', 'app', file))
    .find(existsSync);
  const content = buildGradle ? readFileSync(buildGradle, 'utf8') : '';
  const id = content.match(/(?:applicationId|namespace)\s*=?\s*["']([a-z][a-z0-9_.]*)["']/)?.[1];
  return id && id.includes('.') ? id : 'com.example';
}

function moduleName(project: RNProject): string {
  const packageJson = readJson(path.join(project.root, 'package.json'));
  const name = pascalCase(String(packageJson.name ?? 'Module').replace(/^@[^/]+\//, ''));
  return /^[A-Za-z]/.test(name) ? name : `Module${name}`;
}

function renderConfig(project: RNProject): string {
  return `import { defineConfig } from '@team-poppang/nativepiece-cli';

export default defineConfig({
  // Swift 모듈 이름과 Kotlin 객체 이름으로 쓰여요.
  name: '${moduleName(project)}',
  entry: 'nativepiece.entry.ts',
  contract: 'nativepiece.contract.ts',
  ios: {
    deploymentTarget: '${iosDeploymentTarget(project)}',
  },
  android: {
    // Maven groupId예요. 회사 도메인으로 바꿔 주세요.
    group: '${androidGroup(project)}',
  },
});
`;
}

function renderContract(screens: RegisteredScreen[]): string {
  const screenLines = screens.length > 0
    ? screens.map((screen) => `    // 기존 AppRegistry 이름: '${screen.appKey}'. props 타입을 채워 주세요.\n    ${screen.screenName}: screen(),`).join('\n')
    : '    main: screen(),';
  return `import { call, defineContract, event, message, screen } from '@team-poppang/nativepiece-runtime';

// 모듈과 호스트 앱이 주고받는 것을 정의해요. \`nativepiece codegen\`이 이 파일로 Swift·Kotlin 타입을 만들어요.
export default defineContract({
  screens: {
${screenLines}
  },
  events: {
    // 예: requestSubmitted: event<{ requestId: string }>(),
  },
  calls: {
    // 예: getAccessToken: call<void, { token: string }>(),
  },
  messages: {
    // 예: userChanged: message<{ userUuid: string }>(),
  },
});

// 아직 쓰지 않는 helper import 경고를 막아요. 항목을 추가하면 지워도 돼요.
void call;
void event;
void message;
`;
}

function renderEntry(screens: RegisteredScreen[], project: RNProject): string {
  if (screens.length === 0) {
    return `import { View } from 'react-native';
import { defineModule } from '@team-poppang/nativepiece-runtime';
import contract from './nativepiece.contract';

// TODO: 모듈로 보여 줄 화면 컴포넌트로 바꿔 주세요.
function Main() {
  return <View />;
}

export default defineModule(contract, {
  main: Main,
});
`;
  }

  const imports = new Map<string, string[]>();
  for (const screen of screens) {
    // 원래 진입점 파일 기준의 import 경로를 프로젝트 루트 기준으로 바꾼다.
    const importPath = screen.importPath.startsWith('.')
      ? `./${path.relative(project.root, path.resolve(project.root, path.dirname(screen.sourceFile), screen.importPath))}`
      : screen.importPath;
    const binding = screen.isDefaultImport ? screen.componentName : `{ ${screen.componentName} }`;
    imports.set(binding, [...(imports.get(binding) ?? []), importPath]);
  }
  const importLines = [...imports].map(([binding, [importPath]]) => `import ${binding} from '${importPath}';`);

  return `import { defineModule } from '@team-poppang/nativepiece-runtime';
import contract from './nativepiece.contract';
${importLines.join('\n')}

export default defineModule(contract, {
${screens.map((screen) => `  ${screen.screenName}: ${screen.componentName},`).join('\n')}
});
`;
}

function cliVersion(): string {
  return readJson(packagePath('package.json')).version;
}

async function confirm(question: string): Promise<boolean> {
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await readline.question(`${question} (y/N) `)).trim().toLowerCase();
  readline.close();
  return answer === 'y' || answer === 'yes';
}

export async function init(project: RNProject, options: InitOptions = {}): Promise<void> {
  log.step('프로젝트 진단');
  const problems = checkProject(project);
  for (const problem of problems) {
    if (problem.level === 'ok') continue;
    (problem.level === 'error' ? log.error : log.warn)(problem.title);
    if (problem.detail) log.info(pc.dim(problem.detail));
  }
  if (problems.some((problem) => problem.level === 'error')) {
    throw new Error('위 문제를 해결한 뒤 다시 실행해 주세요.');
  }

  const screens = findRegisteredScreens(project);
  if (screens.length > 0) {
    log.info(`AppRegistry에 등록된 화면 ${screens.length}개를 찾았어요: ${screens.map((screen) => screen.appKey).join(', ')}`);
  } else {
    log.warn('AppRegistry.registerComponent 호출을 찾지 못했어요. 예제 화면으로 시작해요.');
  }

  const plan: PlannedFile[] = [];
  const write = (file: string, description: string, content: string) => {
    const target = path.join(project.root, file);
    if (existsSync(target)) {
      log.warn(`${file}이(가) 이미 있어서 건너뛰어요.`);
      return;
    }
    plan.push({ path: file, description, apply: () => writeFile(target, content) });
  };

  if (!findConfigPath(project.root)) write('nativepiece.config.ts', '모듈 설정', renderConfig(project));
  write('nativepiece.contract.ts', '호스트 앱과 주고받을 계약', renderContract(screens));
  write('nativepiece.entry.ts', '모듈 JS 진입점', renderEntry(screens, project));

  const packageJsonPath = path.join(project.root, 'package.json');
  const packageJson = readJson(packageJsonPath);
  const version = `^${cliVersion()}`;
  const scripts: Record<string, string> = {
    'nativepiece:doctor': 'nativepiece doctor',
    'nativepiece:codegen': 'nativepiece codegen',
    'nativepiece:build:ios': 'nativepiece build ios',
    'nativepiece:build:android': 'nativepiece build android',
  };
  const missingScripts = Object.keys(scripts).filter((name) => !packageJson.scripts?.[name]);
  const needsRuntime = !packageJson.dependencies?.['@team-poppang/nativepiece-runtime'];
  const needsCli = !packageJson.devDependencies?.['@team-poppang/nativepiece-cli'];
  if (needsRuntime || needsCli || missingScripts.length > 0) {
    plan.push({
      path: 'package.json',
      description: '@team-poppang/nativepiece-runtime, @team-poppang/nativepiece-cli 의존성과 nativepiece:* 스크립트 추가',
      apply: async () => {
        if (needsRuntime) packageJson.dependencies = { ...packageJson.dependencies, '@team-poppang/nativepiece-runtime': version };
        if (needsCli) packageJson.devDependencies = { ...packageJson.devDependencies, '@team-poppang/nativepiece-cli': version };
        packageJson.scripts = { ...packageJson.scripts };
        for (const name of missingScripts) packageJson.scripts[name] = scripts[name];
        await writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);
      },
    });
  }

  const npmrc = path.join(project.root, '.npmrc');
  const registryLine = '@team-poppang:registry=https://npm.pkg.github.com';
  if (!existsSync(npmrc) || !readFileSync(npmrc, 'utf8').includes('@team-poppang:registry')) {
    plan.push({
      path: '.npmrc',
      description: '@team-poppang 패키지를 GitHub Packages에서 받도록 설정 (토큰은 넣지 않아요)',
      apply: () => appendFile(npmrc, `\n# Nativepiece\n${registryLine}\n`),
    });
  }

  const gitignore = path.join(project.root, '.gitignore');
  if (!existsSync(gitignore) || !readFileSync(gitignore, 'utf8').split('\n').some((line) => line.trim().replace(/\/$/, '') === '.nativepiece')) {
    plan.push({ path: '.gitignore', description: '.nativepiece/ 작업 공간 제외', apply: () => appendFile(gitignore, '\n# Nativepiece\n.nativepiece/\n') });
  }

  if (plan.length === 0) {
    log.success('이미 Nativepiece가 설정돼 있어요.');
    return;
  }

  console.log(pc.bold('\n다음 파일을 만들거나 고쳐요. 기존 ios/, android/, 앱 소스는 건드리지 않아요.'));
  for (const item of plan) console.log(`  ${pc.cyan(item.path)} ${pc.dim(`— ${item.description}`)}`);
  console.log('');

  if (!options.yes && !(await confirm('진행할까요?'))) {
    log.info('취소했어요.');
    return;
  }

  for (const item of plan) await item.apply();
  log.success('Nativepiece 설정을 마쳤어요.');

  const legacy = LEGACY_DIRECTORIES.filter((directory) => existsSync(path.join(project.root, directory)));
  if (legacy.length > 0) {
    log.warn(`이전 빌드 파이프라인이 있어요: ${legacy.join(', ')}`);
    log.info('Nativepiece 결과물을 확인한 뒤 지워도 돼요. 자동으로 지우지 않아요.');
  }

  console.log(pc.bold('\n다음 단계'));
  console.log('  1. npm install  (GitHub Packages 읽기 토큰이 필요해요: README의 "설치 준비" 참고)');
  console.log('  2. nativepiece.contract.ts에 화면 props, 이벤트, 호출을 채워요');
  console.log('  3. npx nativepiece doctor');
  console.log('  4. npx nativepiece build ios / npx nativepiece build android');
}
