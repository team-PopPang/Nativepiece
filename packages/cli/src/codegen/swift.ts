import type { ContractItem, ContractModel, TypeRef } from './model.js';
import { pascalCase } from './model.js';

const KEYWORDS = new Set([
  'associatedtype', 'class', 'deinit', 'enum', 'extension', 'func', 'import', 'init', 'inout', 'internal', 'let',
  'operator', 'private', 'protocol', 'public', 'static', 'struct', 'subscript', 'typealias', 'var', 'break', 'case',
  'continue', 'default', 'defer', 'do', 'else', 'fallthrough', 'for', 'guard', 'if', 'in', 'repeat', 'return',
  'switch', 'where', 'while', 'as', 'catch', 'false', 'is', 'nil', 'rethrows', 'super', 'self', 'Self', 'throw',
  'throws', 'true', 'try',
]);

function identifier(name: string): string {
  return KEYWORDS.has(name) ? `\`${name}\`` : name;
}

function caseName(name: string): string {
  const camel = name.replace(/^./, (first) => first.toLowerCase());
  return identifier(camel);
}

function swiftType(type: TypeRef): string {
  switch (type.kind) {
    case 'string':
      return 'String';
    case 'number':
      return 'Double';
    case 'boolean':
      return 'Bool';
    case 'array':
      return `[${swiftType(type.element)}]`;
    case 'map':
      return `[String: ${swiftType(type.value)}]`;
    case 'object':
    case 'enum':
      return type.name;
    case 'optional':
      return `${swiftType(type.inner)}?`;
  }
}

function enumCaseName(value: string): string {
  const name = value.replace(/[^A-Za-z0-9]+(.)?/g, (_, next: string | undefined) => (next ? next.toUpperCase() : ''));
  const camel = /^[0-9]/.test(name) ? `_${name}` : name.replace(/^./, (first) => first.toLowerCase());
  return identifier(camel || 'empty');
}

function renderTypes(model: ContractModel): string[] {
  const lines: string[] = [];
  for (const enumType of model.enums) {
    lines.push(`    public enum ${enumType.name}: String, Codable, Sendable, CaseIterable {`);
    for (const value of enumType.values) lines.push(`        case ${enumCaseName(value)} = ${JSON.stringify(value)}`);
    lines.push('    }', '');
  }
  for (const object of model.objects) {
    lines.push(`    public struct ${object.name}: Codable, Sendable {`);
    for (const field of object.fields) lines.push(`        public var ${identifier(field.name)}: ${swiftType(field.type)}`);
    const parameters = object.fields
      .map((field) => `${identifier(field.name)}: ${swiftType(field.type)}${field.type.kind === 'optional' ? ' = nil' : ''}`)
      .join(', ');
    lines.push('', `        public init(${parameters}) {`);
    for (const field of object.fields) lines.push(`            self.${field.name} = ${identifier(field.name)}`);
    lines.push('        }', '    }', '');
  }
  return lines;
}

function renderScreens(screens: ContractItem[]): string[] {
  const lines = ['    public enum Screen: NativepieceScreenRepresentable {'];
  for (const screen of screens) {
    lines.push(`        case ${caseName(screen.name)}${screen.payload ? `(${swiftType(screen.payload)})` : ''}`);
  }
  lines.push('', '        public var screenName: String {', '            switch self {');
  for (const screen of screens) lines.push(`            case .${caseName(screen.name)}: return ${JSON.stringify(screen.name)}`);
  lines.push('            }', '        }', '', '        public func screenProperties() throws -> [String: Any] {', '            switch self {');
  for (const screen of screens) {
    lines.push(
      screen.payload
        ? `            case .${caseName(screen.name)}(let props): return try NativepieceJSON.object(from: props)`
        : `            case .${caseName(screen.name)}: return [:]`,
    );
  }
  lines.push('            }', '        }', '    }', '');
  return lines;
}

function renderEvents(events: ContractItem[]): string[] {
  if (events.length === 0) return [];
  const lines = ['    public enum Event: NativepieceEventRepresentable {'];
  for (const event of events) {
    lines.push(`        case ${caseName(event.name)}${event.payload ? `(${swiftType(event.payload)})` : ''}`);
  }
  lines.push('', '        public init?(name: String, payload: NativepiecePayload) throws {', '            switch name {');
  for (const event of events) {
    lines.push(
      event.payload
        ? `            case ${JSON.stringify(event.name)}: self = .${caseName(event.name)}(try payload.decode(${swiftType(event.payload)}.self))`
        : `            case ${JSON.stringify(event.name)}: self = .${caseName(event.name)}`,
    );
  }
  lines.push('            default: return nil', '            }', '        }', '    }', '');
  return lines;
}

function renderMessages(messages: ContractItem[]): string[] {
  if (messages.length === 0) return [];
  const lines = ['    public enum Message: NativepieceMessageRepresentable {'];
  for (const message of messages) {
    lines.push(`        case ${caseName(message.name)}${message.payload ? `(${swiftType(message.payload)})` : ''}`);
  }
  lines.push('', '        public var messageName: String {', '            switch self {');
  for (const message of messages) lines.push(`            case .${caseName(message.name)}: return ${JSON.stringify(message.name)}`);
  lines.push('            }', '        }', '', '        public var messagePayload: (any Encodable)? {', '            switch self {');
  for (const message of messages) {
    lines.push(
      message.payload
        ? `            case .${caseName(message.name)}(let payload): return payload`
        : `            case .${caseName(message.name)}: return nil`,
    );
  }
  lines.push('            }', '        }', '    }', '');
  return lines;
}

function renderHost(model: ContractModel, moduleName: string): string[] {
  const protocolName = `${moduleName}Host`;
  const lines: string[] = [];

  lines.push(
    `/// ${moduleName} 모듈이 \`host.call(...)\`로 요청하는 기능이에요. 앱이 구현해서 \`${moduleName}.start(host:)\`에 넘겨요.`,
    `@MainActor`,
    `public protocol ${protocolName}: AnyObject {`,
  );
  for (const call of model.calls) {
    const parameter = call.request ? `_ request: ${moduleName}.${swiftType(call.request)}` : '';
    const result = call.response ? ` -> ${moduleName}.${swiftType(call.response)}` : '';
    lines.push(`    func ${caseName(call.name)}(${parameter}) async throws${result}`);
  }
  lines.push('}', '');

  lines.push(`extension ${moduleName} {`);
  lines.push(
    '    /// 런타임을 시작하고 `call` 처리기를 등록해요. 앱 시작 시점(AppDelegate 등)에 한 번 호출해요.',
    '    /// host는 앱이 살아 있는 동안 강하게 참조해요.',
    '    @MainActor',
    `    public static func start(host: some ${protocolName}, prewarm: Bool = true) {`,
  );
  for (const call of model.calls) {
    const name = JSON.stringify(call.name);
    const invoke = `host.${caseName(call.name)}(${call.request ? 'request' : ''})`;
    const body = call.response ? `try await ${invoke}` : `try await ${invoke}; return NativepieceNoValue()`;
    if (call.request) {
      lines.push(`        Nativepiece.shared.handle(${name}, request: ${swiftType(call.request)}.self) { request in ${body} }`);
    } else {
      lines.push(`        Nativepiece.shared.handle(${name}) { ${body} }`);
    }
  }
  lines.push('        start(prewarm: prewarm)', '    }', '}', '');
  return lines;
}

export function renderSwift(model: ContractModel, moduleName: string, version: string): string {
  const lines = [
    `// Generated by Nativepiece ${version} from nativepiece.contract.ts. Do not edit.`,
    'import Foundation',
    'import NativepieceKit',
    '',
    `extension ${moduleName} {`,
    ...renderTypes(model),
    ...renderScreens(model.screens),
    ...renderEvents(model.events),
    ...renderMessages(model.messages),
  ];
  while (lines.at(-1) === '') lines.pop();
  lines.push('}', '');
  if (model.calls.length > 0) lines.push(...renderHost(model, moduleName));
  return lines.join('\n');
}

export { pascalCase };
