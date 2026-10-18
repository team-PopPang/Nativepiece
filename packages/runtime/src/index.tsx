import { createContext, useContext, useEffect, useMemo, useRef, type ComponentType } from 'react';
import { AppRegistry } from 'react-native';
import NativepieceHost, { type HostMessage } from './specs/NativeNativepieceHost';

// 네이티브가 initialProperties에 넣어 주는 내부 값의 key다. 화면 props와 겹치지 않게 접두사를 붙인다.
const INTERNAL_PROP = '__nativepiece';

export const NAVIGATION_EVENT = {
  close: 'np.close',
} as const;

export interface EventDefinition<Payload> {
  readonly name: string;
  // 타입 추론에만 쓰는 값이다. 런타임에는 존재하지 않는다.
  readonly __payload?: Payload;
}

export function defineEvent<Payload = void>(name: string): EventDefinition<Payload> {
  if (name.startsWith('np.')) {
    throw new Error(`"np."로 시작하는 이벤트 이름은 Nativepiece가 예약했어요: ${name}`);
  }
  return { name };
}

export interface ScreenDefinition<Props> {
  component: ComponentType<Props>;
}

export function defineScreen<Props extends object>(component: ComponentType<Props>): ScreenDefinition<Props> {
  return { component };
}

type MessageListener = (payload: unknown) => void;

interface HostContextValue {
  surfaceId: string;
  emit<Payload>(event: EventDefinition<Payload>, ...payload: Payload extends void ? [] : [Payload]): void;
  close(): void;
}

const HostContext = createContext<HostContextValue | null>(null);

function serialize(payload: unknown): string | null {
  return payload === undefined ? null : JSON.stringify(payload);
}

function emitRaw(surfaceId: string, name: string, payload: unknown) {
  NativepieceHost.emit(surfaceId, name, serialize(payload));
}

// 화면 컴포넌트를 감싸 surfaceId를 꺼내고, 호스트와 통신하는 context를 제공한다.
function withHost<Props extends object>(screenKey: string, Screen: ComponentType<Props>) {
  function NativepieceScreenRoot(props: Props & { [INTERNAL_PROP]?: { surfaceId?: string } }) {
    const { [INTERNAL_PROP]: internal, ...screenProps } = props;
    const surfaceId = internal?.surfaceId ?? screenKey;

    const value = useMemo<HostContextValue>(
      () => ({
        surfaceId,
        emit: (event, ...payload) => emitRaw(surfaceId, event.name, payload[0]),
        close: () => emitRaw(surfaceId, NAVIGATION_EVENT.close, undefined),
      }),
      [surfaceId],
    );

    return (
      <HostContext.Provider value={value}>
        <Screen {...(screenProps as Props)} />
      </HostContext.Provider>
    );
  }
  NativepieceScreenRoot.displayName = `Nativepiece(${screenKey})`;
  return NativepieceScreenRoot;
}

export interface ModuleDefinition<Screens extends Record<string, ScreenDefinition<any>>> {
  screens: Screens;
  events?: Record<string, EventDefinition<any>>;
}

// 화면마다 AppRegistry에 등록한다. 네이티브는 screen key를 moduleName으로 써서 화면을 연다.
export function defineModule<Screens extends Record<string, ScreenDefinition<any>>>(
  definition: ModuleDefinition<Screens>,
): ModuleDefinition<Screens> {
  for (const [screenKey, screen] of Object.entries(definition.screens)) {
    const Root = withHost(screenKey, screen.component);
    AppRegistry.registerComponent(screenKey, () => Root);
  }
  return definition;
}

export function useHost(): HostContextValue {
  const host = useContext(HostContext);
  if (!host) {
    throw new Error('useHost는 defineModule로 등록한 화면 안에서만 쓸 수 있어요.');
  }
  return host;
}

// 앱이 보낸 메시지를 받는다. 이 화면에 보낸 메시지와 모든 화면에 보낸 메시지를 함께 받는다.
export function useHostMessage<Payload = unknown>(name: string, listener: (payload: Payload) => void): void {
  const { surfaceId } = useHost();
  const listenerRef = useRef<MessageListener>(listener as MessageListener);
  listenerRef.current = listener as MessageListener;

  useEffect(() => {
    const subscription = NativepieceHost.onHostMessage((message: HostMessage) => {
      if (message.name !== name) return;
      if (message.surfaceId !== null && message.surfaceId !== surfaceId) return;
      listenerRef.current(message.payloadJson === null ? undefined : JSON.parse(message.payloadJson));
    });
    return () => subscription.remove();
  }, [name, surfaceId]);
}
