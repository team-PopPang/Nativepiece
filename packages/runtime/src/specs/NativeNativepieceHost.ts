import type { CodegenTypes, TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

// 네이티브와 주고받는 값은 모두 JSON 문자열로 된 envelope 하나다. 형식은 protocol.ts에 정의한다.
export interface Spec extends TurboModule {
  post(envelopeJson: string): void;
  protocolVersion(): number;
  readonly onEnvelope: CodegenTypes.EventEmitter<string>;
}

export default TurboModuleRegistry.getEnforcing<Spec>('NativepieceHost');
