import type { ContractItem, ContractModel, TypeRef } from './model.js';
import { pascalCase } from './model.js';

const KEYWORDS = new Set([
  'as', 'break', 'class', 'continue', 'do', 'else', 'false', 'for', 'fun', 'if', 'in', 'interface', 'is', 'null',
  'object', 'package', 'return', 'super', 'this', 'throw', 'true', 'try', 'typealias', 'typeof', 'val', 'var', 'when',
  'while',
]);

function identifier(name: string): string {
  return KEYWORDS.has(name) ? `\`${name}\`` : name;
}

function kotlinType(type: TypeRef): string {
  switch (type.kind) {
    case 'string':
      return 'String';
    case 'number':
      return 'Double';
    case 'boolean':
      return 'Boolean';
    case 'array':
      return `List<${kotlinType(type.element)}>`;
    case 'map':
      return `Map<String, ${kotlinType(type.value)}>`;
    case 'object':
    case 'enum':
      return type.name;
    case 'optional':
      return `${kotlinType(type.inner)}?`;
  }
}

// Kotlin 값을 org.json 값으로 바꾸는 식을 만든다.
function encode(type: TypeRef, value: string): string {
  switch (type.kind) {
    case 'string':
    case 'number':
    case 'boolean':
      return value;
    case 'enum':
      return `${value}.value`;
    case 'object':
      return `${value}.toJson()`;
    case 'array':
      return `JSONArray().apply { ${value}.forEach { put(${encode(type.element, 'it')}) } }`;
    case 'map':
      return `JSONObject().apply { ${value}.forEach { (key, item) -> put(key, ${encode(type.value, 'item')}) } }`;
    case 'optional':
      return `(${value}?.let { ${encode(type.inner, 'it')} } ?: JSONObject.NULL)`;
  }
}

// JSONObject(key)나 JSONArray(index)에서 값을 꺼내는 식을 만든다. 두 타입은 접근 메서드 이름이 같다.
function decode(type: TypeRef, container: string, key: string): string {
  switch (type.kind) {
    case 'string':
      return `${container}.getString(${key})`;
    case 'number':
      return `${container}.getDouble(${key})`;
    case 'boolean':
      return `${container}.getBoolean(${key})`;
    case 'enum':
      return `${type.name}.fromValue(${container}.getString(${key}))`;
    case 'object':
      return `${type.name}.fromJson(${container}.getJSONObject(${key}))`;
    case 'array':
      return `${container}.getJSONArray(${key}).let { array -> List(array.length()) { index -> ${decode(type.element, 'array', 'index')} } }`;
    case 'map':
      return `${container}.getJSONObject(${key}).let { map -> map.keys().asSequence().associateWith { item -> ${decode(type.value, 'map', 'item')} } }`;
    case 'optional':
      return `(if (${container}.has(${key}) && !${container}.isNull(${key})) ${decode(type.inner, container, key)} else null)`;
  }
}

function enumEntry(value: string): string {
  const name = value
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase();
  return /^[0-9]/.test(name) || name === '' ? `V_${name}` : name;
}

function renderTypes(model: ContractModel): string[] {
  const lines: string[] = [];
  for (const enumType of model.enums) {
    lines.push(`    enum class ${enumType.name}(val value: String) {`);
    lines.push(...enumType.values.map((value, index) => `        ${enumEntry(value)}(${JSON.stringify(value)})${index < enumType.values.length - 1 ? ',' : ';'}`));
    lines.push(
      '',
      '        companion object {',
      `            fun fromValue(value: String): ${enumType.name} =`,
      `                entries.firstOrNull { it.value == value } ?: throw IllegalArgumentException("알 수 없는 ${enumType.name} 값이에요: $value")`,
      '        }',
      '    }',
      '',
    );
  }
  for (const object of model.objects) {
    const parameters = object.fields
      .map((field) => `        val ${identifier(field.name)}: ${kotlinType(field.type)}${field.type.kind === 'optional' ? ' = null' : ''},`)
      .join('\n');
    lines.push(`    data class ${object.name}(`, parameters, '    ) {');
    lines.push('        fun toJson(): JSONObject = JSONObject().apply {');
    for (const field of object.fields) {
      const value = identifier(field.name);
      lines.push(
        field.type.kind === 'optional'
          ? `            if (${value} != null) put(${JSON.stringify(field.name)}, ${encode(field.type.inner, value)})`
          : `            put(${JSON.stringify(field.name)}, ${encode(field.type, value)})`,
      );
    }
    lines.push('        }', '', '        companion object {', `            fun fromJson(json: JSONObject): ${object.name} = ${object.name}(`);
    for (const field of object.fields) {
      lines.push(`                ${identifier(field.name)} = ${decode(field.type, 'json', JSON.stringify(field.name))},`);
    }
    lines.push('            )', '        }', '    }', '');
  }
  return lines;
}

function renderScreens(screens: ContractItem[]): string[] {
  const lines = ['    sealed class Screen(override val screenName: String) : NativepieceScreenRepresentable {'];
  for (const screen of screens) {
    const className = pascalCase(screen.name);
    if (!screen.payload) {
      lines.push(`        data object ${className} : Screen(${JSON.stringify(screen.name)}) {`, '            override fun screenProps(): JSONObject? = null', '        }');
    } else if (screen.payload.kind === 'object') {
      lines.push(
        `        data class ${className}(val props: ${kotlinType(screen.payload)}) : Screen(${JSON.stringify(screen.name)}) {`,
        '            override fun screenProps(): JSONObject = props.toJson()',
        '        }',
      );
    } else {
      throw new Error(`화면 props는 객체 타입이어야 해요: ${screen.name}`);
    }
  }
  lines.push('    }', '');
  return lines;
}

function renderEvents(events: ContractItem[]): string[] {
  if (events.length === 0) return [];
  const lines = ['    sealed class Event {'];
  for (const event of events) {
    const className = pascalCase(event.name);
    lines.push(event.payload ? `        data class ${className}(val payload: ${kotlinType(event.payload)}) : Event()` : `        data object ${className} : Event()`);
  }
  lines.push('', '        companion object {', '            /** 모르는 이벤트 이름이면 null이에요. */', '            fun decode(name: String, payload: NativepiecePayload): Event? = when (name) {');
  for (const event of events) {
    const className = pascalCase(event.name);
    lines.push(
      event.payload
        ? `                ${JSON.stringify(event.name)} -> ${className}(${decode(event.payload, 'NativepieceJson.box(payload)', '0')})`
        : `                ${JSON.stringify(event.name)} -> ${className}`,
    );
  }
  lines.push('                else -> null', '            }', '        }', '    }', '');
  return lines;
}

function renderMessages(messages: ContractItem[]): string[] {
  if (messages.length === 0) return [];
  const lines = ['    sealed class Message(override val messageName: String) : NativepieceMessageRepresentable {'];
  for (const message of messages) {
    const className = pascalCase(message.name);
    if (message.payload) {
      lines.push(
        `        data class ${className}(val payload: ${kotlinType(message.payload)}) : Message(${JSON.stringify(message.name)}) {`,
        `            override fun messagePayload(): Any? = ${encode(message.payload, 'payload')}`,
        '        }',
      );
    } else {
      lines.push(`        data object ${className} : Message(${JSON.stringify(message.name)}) {`, '            override fun messagePayload(): Any? = null', '        }');
    }
  }
  lines.push('    }', '');
  return lines;
}

function renderHost(model: ContractModel): string[] {
  if (model.calls.length === 0) return [];
  const lines = [
    '    /** 모듈이 `host.call(...)`로 요청하는 기능이에요. 앱이 구현해서 [start]나 [register]에 넘겨요. */',
    '    interface Host {',
  ];
  for (const call of model.calls) {
    const parameters = [
      ...(call.request ? [`request: ${kotlinType(call.request)}`] : []),
      `reply: NativepieceTypedReply<${call.response ? kotlinType(call.response) : 'Unit'}>`,
    ].join(', ');
    lines.push(`        fun ${identifier(call.name)}(${parameters})`);
  }
  lines.push('    }', '', '    /** `call` 처리기를 등록해요. */', '    @JvmStatic', '    fun register(host: Host) {');
  for (const call of model.calls) {
    const encoder = call.response ? `{ value: ${kotlinType(call.response)} -> ${encode(call.response, 'value')} }` : '{ _: Unit -> null }';
    const args = [...(call.request ? [decode(call.request, 'NativepieceJson.box(payload)', '0')] : []), `NativepieceTypedReply.wrap(reply, ${encoder})`].join(', ');
    lines.push(`        Nativepiece.handle(${JSON.stringify(call.name)}) { payload, reply -> host.${identifier(call.name)}(${args}) }`);
  }
  lines.push(
    '    }',
    '',
    '    /** 런타임을 시작하고 `call` 처리기를 등록해요. Application.onCreate에서 한 번 호출해요. */',
    '    @JvmStatic',
    '    @JvmOverloads',
    '    fun start(application: Application, host: Host, prewarm: Boolean = true) {',
    '        Nativepiece.init(application, prewarm)',
    '        register(host)',
    '    }',
    '',
  );
  return lines;
}

export function renderKotlin(model: ContractModel, moduleName: string, packageName: string, version: string): string {
  const lines = [
    `// Generated by Nativepiece ${version} from nativepiece.contract.ts. Do not edit.`,
    `package ${packageName}`,
    '',
    'import android.app.Application',
    'import io.nativepiece.host.Nativepiece',
    'import io.nativepiece.host.NativepieceFragment',
    'import io.nativepiece.host.NativepieceJson',
    'import io.nativepiece.host.NativepieceMessageRepresentable',
    'import io.nativepiece.host.NativepiecePayload',
    'import io.nativepiece.host.NativepieceScreenRepresentable',
    'import io.nativepiece.host.NativepieceTypedReply',
    'import org.json.JSONArray',
    'import org.json.JSONObject',
    '',
    `object ${moduleName} {`,
    `    const val VERSION = ${JSON.stringify(version)}`,
    '',
    ...renderTypes(model),
    ...renderScreens(model.screens),
    ...renderEvents(model.events),
    ...renderMessages(model.messages),
    ...renderHost(model),
  ];
  if (model.calls.length === 0) {
    lines.push(
      '    /** 런타임을 시작해요. Application.onCreate에서 한 번 호출해요. */',
      '    @JvmStatic',
      '    @JvmOverloads',
      '    fun start(application: Application, prewarm: Boolean = true) = Nativepiece.init(application, prewarm)',
      '',
    );
  }
  while (lines.at(-1) === '') lines.pop();
  lines.push('}', '');

  if (model.events.length > 0) {
    lines.push(
      `/** 계약의 이벤트를 타입으로 받아요. */`,
      `fun NativepieceFragment.on${moduleName}Event(handler: (${moduleName}.Event) -> Unit) =`,
      `    onAnyEvent { name, payload -> ${moduleName}.Event.decode(name, payload)?.let(handler) }`,
      '',
    );
  }
  return lines.join('\n');
}
