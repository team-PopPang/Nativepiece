// 모듈과 호스트 앱 사이의 계약을 정의한다. codegen은 이 파일의 타입으로 Swift·Kotlin 코드를 만든다.

declare const phantom: unique symbol;

export interface ScreenContract<Props> {
  readonly kind: 'screen';
  name: string;
  readonly [phantom]?: Props;
}

/** RN → 호스트로 알리는 이벤트예요. */
export interface EventContract<Payload> {
  readonly kind: 'event';
  name: string;
  readonly [phantom]?: Payload;
}

/** RN이 호스트에 요청하고 응답을 받는 호출이에요. */
export interface CallContract<Request, Response> {
  readonly kind: 'call';
  name: string;
  readonly [phantom]?: [Request, Response];
}

/** 호스트 → RN으로 보내는 메시지예요. */
export interface MessageContract<Payload> {
  readonly kind: 'message';
  name: string;
  readonly [phantom]?: Payload;
}

export const screen = <Props extends object = {}>(): ScreenContract<Props> => ({ kind: 'screen', name: '' });
export const event = <Payload = void>(): EventContract<Payload> => ({ kind: 'event', name: '' });
export const call = <Request = void, Response = void>(): CallContract<Request, Response> => ({ kind: 'call', name: '' });
export const message = <Payload = void>(): MessageContract<Payload> => ({ kind: 'message', name: '' });

export interface ContractDefinition {
  screens: Record<string, ScreenContract<any>>;
  events?: Record<string, EventContract<any>>;
  calls?: Record<string, CallContract<any, any>>;
  messages?: Record<string, MessageContract<any>>;
}

export type ScreenProps<S> = S extends ScreenContract<infer Props> ? Props : never;
export type EventPayload<E> = E extends EventContract<infer Payload> ? Payload : never;
export type CallRequest<C> = C extends CallContract<infer Request, any> ? Request : never;
export type CallResponse<C> = C extends CallContract<any, infer Response> ? Response : never;
export type MessagePayload<M> = M extends MessageContract<infer Payload> ? Payload : never;

const RESERVED_PREFIX = 'np.';

// 각 항목의 이름을 객체 key로 채운다. 이름이 곧 호스트와 주고받는 식별자다.
export function defineContract<Contract extends ContractDefinition>(contract: Contract): Contract {
  for (const group of [contract.screens, contract.events, contract.calls, contract.messages]) {
    for (const [key, item] of Object.entries(group ?? {})) {
      if (key.startsWith(RESERVED_PREFIX)) {
        throw new Error(`"${RESERVED_PREFIX}"로 시작하는 이름은 Nativepiece가 예약했어요: ${key}`);
      }
      item.name = key;
    }
  }
  return contract;
}
