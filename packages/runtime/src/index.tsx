import { createContext, useContext, useEffect, useMemo, useRef, type ComponentType } from 'react';
import { AppRegistry } from 'react-native';
import type {
  CallContract,
  CallRequest,
  CallResponse,
  ContractDefinition,
  EventContract,
  EventPayload,
  MessageContract,
  MessagePayload,
  ScreenProps,
} from './contract';
import { getChannel } from './protocol';

export * from './contract';
export { NativepieceCallError, PROTOCOL_VERSION } from './protocol';

// 네이티브가 initialProperties에 넣어 주는 내부 값의 key다. 화면 props와 겹치지 않게 접두사를 붙인다.
const INTERNAL_PROP = '__nativepiece';
const DEFAULT_CALL_TIMEOUT_MS = 10_000;

export const NAVIGATION_EVENT = {
  close: 'np.close',
} as const;

type PayloadArgs<Payload> = [Payload] extends [void] ? [] : [Payload];

export interface CallOptions {
  timeoutMs?: number;
}

export interface Host {
  readonly surfaceId: string;
  emit<E extends EventContract<any>>(event: E, ...payload: PayloadArgs<EventPayload<E>>): void;
  call<C extends CallContract<any, any>>(
    call: C,
    ...args: [...PayloadArgs<CallRequest<C>>, CallOptions?]
  ): Promise<CallResponse<C>>;
  close(): void;
  /** 화면이 쓸 수 있는 상태가 됐다고 알려요. 호스트 SDK가 이 시점으로 surfaceReady 지표를 계산해요. */
  markReady(): void;
}

const HostContext = createContext<Host | null>(null);

function createHost(surfaceId: string): Host {
  const channel = getChannel();
  return {
    surfaceId,
    emit: (event, ...payload) => channel.emit(surfaceId, event.name, payload[0]),
    call: ((call: CallContract<any, any>, ...args: unknown[]) => {
      const options = (args.length > 1 ? args[1] : undefined) as CallOptions | undefined;
      return channel.call(surfaceId, call.name, args[0], options?.timeoutMs ?? DEFAULT_CALL_TIMEOUT_MS);
    }) as Host['call'],
    close: () => channel.emit(surfaceId, NAVIGATION_EVENT.close, undefined),
    markReady: () => channel.lifecycle('surfaceReady', surfaceId),
  };
}

// 화면 컴포넌트를 감싸 surfaceId를 꺼내고, 호스트와 통신하는 context를 제공한다.
function withHost<Props extends object>(screenKey: string, Screen: ComponentType<Props>) {
  function NativepieceScreenRoot(props: Props & { [INTERNAL_PROP]?: { surfaceId?: string } }) {
    const { [INTERNAL_PROP]: internal, ...screenProps } = props;
    const surfaceId = internal?.surfaceId ?? screenKey;
    const host = useMemo(() => createHost(surfaceId), [surfaceId]);

    useEffect(() => {
      getChannel().lifecycle('surfaceMounted', surfaceId);
      return () => getChannel().dropSurface(surfaceId);
    }, [surfaceId]);

    return (
      <HostContext.Provider value={host}>
        <Screen {...(screenProps as Props)} />
      </HostContext.Provider>
    );
  }
  NativepieceScreenRoot.displayName = `Nativepiece(${screenKey})`;
  return NativepieceScreenRoot;
}

export type ScreenComponents<Contract extends ContractDefinition> = {
  [Key in keyof Contract['screens']]: ComponentType<ScreenProps<Contract['screens'][Key]>>;
};

// 계약의 화면마다 컴포넌트를 AppRegistry에 등록한다. 네이티브는 화면 이름을 moduleName으로 써서 화면을 연다.
export function defineModule<Contract extends ContractDefinition>(
  contract: Contract,
  screens: ScreenComponents<Contract>,
): Contract {
  for (const [key, definition] of Object.entries(contract.screens)) {
    const component = (screens as Record<string, ComponentType<any>>)[key];
    if (!component) throw new Error(`화면 컴포넌트가 없어요: ${key}`);
    const Root = withHost(definition.name, component);
    AppRegistry.registerComponent(definition.name, () => Root);
  }
  // 모든 화면이 등록됐으면 번들 평가가 끝난 것이다.
  getChannel().lifecycle('runtimeReady');
  return contract;
}

export function useHost(): Host {
  const host = useContext(HostContext);
  if (!host) {
    throw new Error('useHost는 defineModule로 등록한 화면 안에서만 쓸 수 있어요.');
  }
  return host;
}

/** 호스트가 보낸 메시지를 받아요. 이 화면에 보낸 메시지와 모든 화면에 보낸 메시지를 함께 받아요. */
export function useHostMessage<M extends MessageContract<any>>(
  message: M,
  listener: (payload: MessagePayload<M>) => void,
): void {
  const { surfaceId } = useHost();
  const listenerRef = useRef(listener);
  listenerRef.current = listener;

  useEffect(
    () => getChannel().subscribe(surfaceId, message.name, (payload) => listenerRef.current(payload as MessagePayload<M>)),
    [message.name, surfaceId],
  );
}
