import type { CodegenTypes, TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

export type HostMessage = {
  // null이면 모든 화면에 보내는 메시지다.
  surfaceId: string | null;
  name: string;
  payloadJson: string | null;
};

export interface Spec extends TurboModule {
  emit(surfaceId: string, name: string, payloadJson: string | null): void;
  readonly onHostMessage: CodegenTypes.EventEmitter<HostMessage>;
}

export default TurboModuleRegistry.getEnforcing<Spec>('NativepieceHost');
