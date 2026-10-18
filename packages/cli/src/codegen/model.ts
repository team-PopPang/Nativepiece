import path from 'node:path';
import ts from 'typescript';

// 계약 파일의 TS 타입을 플랫폼과 무관한 모델로 바꾼다. Swift·Kotlin 생성기는 이 모델만 본다.

export type TypeRef =
  | { kind: 'string' }
  | { kind: 'number' }
  | { kind: 'boolean' }
  | { kind: 'array'; element: TypeRef }
  | { kind: 'map'; value: TypeRef }
  | { kind: 'object'; name: string }
  | { kind: 'enum'; name: string }
  | { kind: 'optional'; inner: TypeRef };

export interface Field {
  name: string;
  type: TypeRef;
}

export interface ObjectType {
  name: string;
  fields: Field[];
}

export interface EnumType {
  name: string;
  values: string[];
}

export interface ContractItem {
  name: string;
  // null이면 값이 없다(void).
  payload: TypeRef | null;
}

export interface CallItem {
  name: string;
  request: TypeRef | null;
  response: TypeRef | null;
}

export interface ContractModel {
  screens: ContractItem[];
  events: ContractItem[];
  calls: CallItem[];
  messages: ContractItem[];
  objects: ObjectType[];
  enums: EnumType[];
}

const GROUPS = ['screens', 'events', 'calls', 'messages'] as const;
const SWIFT_KEYWORDS = new Set(['default', 'class', 'struct', 'enum', 'protocol', 'func', 'var', 'let', 'in', 'is', 'as', 'self', 'Type']);

export class ContractError extends Error {}

export function pascalCase(value: string): string {
  return value
    .replace(/[^A-Za-z0-9]+(.)?/g, (_, next: string | undefined) => (next ? next.toUpperCase() : ''))
    .replace(/^./, (first) => first.toUpperCase());
}

function location(node: ts.Node): string {
  const source = node.getSourceFile();
  const { line, character } = source.getLineAndCharacterOfPosition(node.getStart());
  return `${path.basename(source.fileName)}:${line + 1}:${character + 1}`;
}

class Extractor {
  private readonly objects = new Map<string, ObjectType>();
  private readonly enums = new Map<string, EnumType>();
  // 같은 TS 타입은 같은 이름으로 한 번만 만든다.
  private readonly names = new Map<ts.Type, string>();

  constructor(private readonly checker: ts.TypeChecker) {}

  model(groups: Record<(typeof GROUPS)[number], ts.ObjectLiteralExpression | undefined>): ContractModel {
    const items = (group: (typeof GROUPS)[number], suffix: string) =>
      this.entries(groups[group]).map(({ name, typeArguments }) => ({
        name,
        payload: typeArguments[0] ? this.payload(typeArguments[0], `${pascalCase(name)}${suffix}`) : null,
      }));

    return {
      screens: items('screens', 'Props'),
      events: items('events', 'Event'),
      messages: items('messages', 'Message'),
      calls: this.entries(groups.calls).map(({ name, typeArguments }) => ({
        name,
        request: typeArguments[0] ? this.payload(typeArguments[0], `${pascalCase(name)}Request`) : null,
        response: typeArguments[1] ? this.payload(typeArguments[1], `${pascalCase(name)}Response`) : null,
      })),
      objects: [...this.objects.values()],
      enums: [...this.enums.values()],
    };
  }

  private entries(literal: ts.ObjectLiteralExpression | undefined) {
    if (!literal) return [];
    return literal.properties.map((property) => {
      if (!ts.isPropertyAssignment(property) || !ts.isCallExpression(property.initializer)) {
        throw new ContractError(`${location(property)}: screen(), event(), call(), message() 중 하나로 정의해 주세요.`);
      }
      const name = property.name.getText().replace(/^['"]|['"]$/g, '');
      if (!/^[A-Za-z][A-Za-z0-9]*$/.test(name)) {
        throw new ContractError(`${location(property)}: 이름은 영문자로 시작하는 영문자·숫자 조합이어야 해요: ${name}`);
      }
      return { name, typeArguments: [...(property.initializer.typeArguments ?? [])] };
    });
  }

  // 화면 props나 payload 최상위 타입. void나 빈 객체면 값이 없는 것으로 본다.
  private payload(node: ts.TypeNode, name: string): TypeRef | null {
    const type = this.checker.getTypeFromTypeNode(node);
    if (type.flags & (ts.TypeFlags.Void | ts.TypeFlags.Undefined)) return null;
    if (this.isPlainObject(type) && this.checker.getPropertiesOfType(type).length === 0 && !this.indexValue(type)) return null;
    return this.convert(type, name, node);
  }

  private convert(type: ts.Type, contextName: string, node: ts.Node): TypeRef {
    const nullable = type.isUnion() && type.types.some((member) => member.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined));
    if (nullable) {
      const rest = (type as ts.UnionType).types.filter((member) => !(member.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined)));
      return { kind: 'optional', inner: this.convertMembers(rest, type, contextName, node) };
    }

    if (type.flags & (ts.TypeFlags.String | ts.TypeFlags.StringLiteral)) return { kind: 'string' };
    if (type.flags & (ts.TypeFlags.Number | ts.TypeFlags.NumberLiteral)) return { kind: 'number' };
    if (type.flags & (ts.TypeFlags.Boolean | ts.TypeFlags.BooleanLiteral)) return { kind: 'boolean' };

    if (type.isUnion()) return this.convertMembers(type.types, type, contextName, node);

    if (this.checker.isArrayType(type)) {
      const [element] = this.checker.getTypeArguments(type as ts.TypeReference);
      return { kind: 'array', element: this.convert(element, `${contextName}Item`, node) };
    }

    if (this.isBuiltIn(type)) {
      throw new ContractError(
        `${location(node)}: ${this.checker.typeToString(type)} 타입은 JSON으로 주고받을 수 없어요. ` +
          '날짜는 ISO 문자열(string)이나 timestamp(number)로 바꿔 주세요.',
      );
    }

    if (this.isPlainObject(type)) {
      const indexValue = this.indexValue(type);
      if (indexValue && this.checker.getPropertiesOfType(type).length === 0) {
        return { kind: 'map', value: this.convert(indexValue, `${contextName}Value`, node) };
      }
      return this.objectType(type, contextName, node);
    }

    throw new ContractError(
      `${location(node)}: ${this.checker.typeToString(type)} 타입은 지원하지 않아요. ` +
        'string, number, boolean, 문자열 리터럴 union, 배열, 객체, Record<string, T>, optional만 쓸 수 있어요.',
    );
  }

  // union의 멤버들을 하나의 타입으로 바꾼다. 문자열 리터럴 union은 enum, true | false는 boolean이다.
  private convertMembers(members: ts.Type[], union: ts.Type, contextName: string, node: ts.Node): TypeRef {
    if (members.length === 1) return this.convert(members[0], contextName, node);
    if (members.every((member) => member.flags & ts.TypeFlags.BooleanLiteral)) return { kind: 'boolean' };
    if (members.every((member) => member.isStringLiteral())) {
      return this.enumType(union, contextName, members.map((member) => (member as ts.StringLiteralType).value));
    }
    throw new ContractError(`${location(node)}: ${this.checker.typeToString(union)} 같은 서로 다른 타입의 union은 지원하지 않아요.`);
  }

  // Date, Map, Promise처럼 TS 기본 라이브러리에 선언된 타입이다.
  private isBuiltIn(type: ts.Type): boolean {
    const declarations = (type.aliasSymbol ?? type.getSymbol())?.getDeclarations() ?? [];
    return declarations.some((declaration) => /[\\/]typescript[\\/]lib[\\/]lib\.[^\\/]*\.d\.ts$/.test(declaration.getSourceFile().fileName));
  }

  private isPlainObject(type: ts.Type): boolean {
    return Boolean(type.flags & ts.TypeFlags.Object) && type.getCallSignatures().length === 0;
  }

  private indexValue(type: ts.Type): ts.Type | undefined {
    return this.checker.getIndexInfoOfType(type, ts.IndexKind.String)?.type;
  }

  private declaredName(type: ts.Type): string | undefined {
    const symbol = type.aliasSymbol ?? type.getSymbol();
    const name = symbol?.getName();
    return name && !name.startsWith('__') ? name : undefined;
  }

  private uniqueName(base: string, taken: Map<string, unknown>): string {
    let name = SWIFT_KEYWORDS.has(base) ? `${base}Value` : base;
    for (let index = 2; taken.has(name); index += 1) name = `${base}${index}`;
    return name;
  }

  private enumType(type: ts.Type, contextName: string, values: string[]): TypeRef {
    const existing = this.names.get(type);
    if (existing) return { kind: 'enum', name: existing };
    const name = this.uniqueName(this.declaredName(type) ?? contextName, this.enums);
    this.names.set(type, name);
    this.enums.set(name, { name, values });
    return { kind: 'enum', name };
  }

  private objectType(type: ts.Type, contextName: string, node: ts.Node): TypeRef {
    const existing = this.names.get(type);
    if (existing) return { kind: 'object', name: existing };
    const name = this.uniqueName(this.declaredName(type) ?? contextName, this.objects);
    this.names.set(type, name);

    const object: ObjectType = { name, fields: [] };
    this.objects.set(name, object);
    for (const property of this.checker.getPropertiesOfType(type)) {
      const propertyType = this.checker.getTypeOfSymbolAtLocation(property, node);
      const optional = Boolean(property.flags & ts.SymbolFlags.Optional);
      let fieldType = this.convert(propertyType, `${name}${pascalCase(property.getName())}`, node);
      if (optional && fieldType.kind !== 'optional') fieldType = { kind: 'optional', inner: fieldType };
      object.fields.push({ name: property.getName(), type: fieldType });
    }
    return { kind: 'object', name };
  }
}

function findDefineContractCall(source: ts.SourceFile): ts.CallExpression {
  let found: ts.CallExpression | undefined;
  const visit = (node: ts.Node) => {
    if (found) return;
    if (ts.isCallExpression(node) && node.expression.getText() === 'defineContract') {
      found = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (!found) {
    throw new ContractError(`${path.basename(source.fileName)}에서 defineContract(...) 호출을 찾지 못했어요.`);
  }
  return found;
}

export function loadContract(contractPath: string): ContractModel {
  const program = ts.createProgram([contractPath], {
    strict: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    skipLibCheck: true,
    noEmit: true,
    jsx: ts.JsxEmit.ReactJSX,
  });
  const source = program.getSourceFile(contractPath);
  if (!source) throw new ContractError(`계약 파일을 읽지 못했어요: ${contractPath}`);

  const diagnostics = ts.getPreEmitDiagnostics(program, source);
  if (diagnostics.length > 0) {
    const message = ts.formatDiagnostics(diagnostics, {
      getCanonicalFileName: (fileName) => fileName,
      getCurrentDirectory: () => path.dirname(contractPath),
      getNewLine: () => '\n',
    });
    throw new ContractError(`계약 파일에 타입 오류가 있어요:\n${message}`);
  }

  const checker = program.getTypeChecker();
  const call = findDefineContractCall(source);
  const [argument] = call.arguments;
  if (!argument || !ts.isObjectLiteralExpression(argument)) {
    throw new ContractError(`${location(call)}: defineContract에는 객체 리터럴을 넘겨 주세요.`);
  }

  const groups = Object.fromEntries(GROUPS.map((group) => [group, undefined])) as Record<
    (typeof GROUPS)[number],
    ts.ObjectLiteralExpression | undefined
  >;
  for (const property of argument.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const key = property.name.getText() as (typeof GROUPS)[number];
    if (!GROUPS.includes(key)) continue;
    if (!ts.isObjectLiteralExpression(property.initializer)) {
      throw new ContractError(`${location(property)}: ${key}에는 객체 리터럴을 넘겨 주세요.`);
    }
    groups[key] = property.initializer;
  }

  return new Extractor(checker).model(groups);
}
