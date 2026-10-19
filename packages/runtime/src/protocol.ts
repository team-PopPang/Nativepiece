import NativepieceHost from './specs/NativeNativepieceHost';

// 호스트 SDK(Swift·Kotlin)의 PROTOCOL_VERSION과 같아야 한다. 형식이 호환되지 않게 바뀔 때만 올린다.
export const PROTOCOL_VERSION = 1;

export type Envelope =
  | { v: number; kind: 'event'; surfaceId: string; name: string; payload?: unknown }
  | { v: number; kind: 'call'; id: string; surfaceId: string; name: string; payload?: unknown }
  | { v: number; kind: 'result'; id: string; ok: true; payload?: unknown }
  | { v: number; kind: 'result'; id: string; ok: false; error: { code: string; message: string } }
  | { v: number; kind: 'message'; surfaceId: string | null; name: string; payload?: unknown }
  | { v: number; kind: 'lifecycle'; name: LifecycleName; surfaceId?: string };

// 호스트 SDK가 성능 지표를 계산할 때 쓰는 시점이다.
export type LifecycleName = 'runtimeReady' | 'surfaceMounted' | 'surfaceReady';

export class NativepieceCallError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'NativepieceCallError';
  }
}

type MessageListener = (payload: unknown) => void;

interface PendingCall {
  resolve(payload: unknown): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

// 아직 구독하지 않은 화면에 온 메시지는 잠시 보관한다. 화면이 열리자마자 보낸 메시지를 놓치지 않기 위해서다.
const MAX_BUFFERED_MESSAGES = 50;

class Channel {
  private nextCallId = 0;
  private readonly pendingCalls = new Map<string, PendingCall>();
  private readonly listeners = new Map<string, Set<MessageListener>>();
  private readonly buffered = new Map<string, unknown[]>();

  constructor() {
    const nativeVersion = NativepieceHost.protocolVersion();
    if (nativeVersion !== PROTOCOL_VERSION) {
      console.error(
        `[Nativepiece] 프로토콜 버전이 달라요 (JS ${PROTOCOL_VERSION}, native ${nativeVersion}). ` +
          '@nativepiece/runtime과 호스트 SDK를 같은 버전으로 빌드해 주세요.',
      );
    }
    NativepieceHost.onEnvelope((json) => this.receive(json));
  }

  emit(surfaceId: string, name: string, payload: unknown) {
    this.post({ v: PROTOCOL_VERSION, kind: 'event', surfaceId, name, payload });
  }

  lifecycle(name: LifecycleName, surfaceId?: string) {
    this.post({ v: PROTOCOL_VERSION, kind: 'lifecycle', name, surfaceId });
  }

  call(surfaceId: string, name: string, payload: unknown, timeoutMs: number): Promise<unknown> {
    const id = String(++this.nextCallId);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingCalls.delete(id);
        reject(new NativepieceCallError('timeout', `${name} 호출이 ${timeoutMs}ms 안에 끝나지 않았어요.`));
      }, timeoutMs);
      this.pendingCalls.set(id, { resolve, reject, timer });
      this.post({ v: PROTOCOL_VERSION, kind: 'call', id, surfaceId, name, payload });
    });
  }

  subscribe(surfaceId: string, name: string, listener: MessageListener): () => void {
    const key = `${surfaceId}\u0000${name}`;
    let set = this.listeners.get(key);
    if (!set) {
      set = new Set();
      this.listeners.set(key, set);
    }
    set.add(listener);

    const pending = this.buffered.get(key);
    if (pending) {
      this.buffered.delete(key);
      pending.forEach((payload) => listener(payload));
    }

    return () => {
      set.delete(listener);
      if (set.size === 0) this.listeners.delete(key);
    };
  }

  private post(envelope: Envelope) {
    NativepieceHost.post(JSON.stringify(envelope));
  }

  private receive(json: string) {
    let envelope: Envelope;
    try {
      envelope = JSON.parse(json);
    } catch {
      console.error('[Nativepiece] 잘못된 envelope을 받았어요:', json);
      return;
    }

    if (envelope.kind === 'result') {
      const pending = this.pendingCalls.get(envelope.id);
      if (!pending) return;
      this.pendingCalls.delete(envelope.id);
      clearTimeout(pending.timer);
      if (envelope.ok) pending.resolve(envelope.payload);
      else pending.reject(new NativepieceCallError(envelope.error.code, envelope.error.message));
      return;
    }

    if (envelope.kind === 'message') {
      this.deliver(envelope.surfaceId, envelope.name, envelope.payload);
    }
  }

  // surfaceId가 null이면 모든 화면에 보낸 메시지다. 구독 중인 화면에 전달한다.
  private deliver(surfaceId: string | null, name: string, payload: unknown) {
    if (surfaceId === null) {
      for (const [key, set] of this.listeners) {
        if (key.endsWith(`\u0000${name}`)) set.forEach((listener) => listener(payload));
      }
      return;
    }

    const key = `${surfaceId}\u0000${name}`;
    const set = this.listeners.get(key);
    if (set && set.size > 0) {
      set.forEach((listener) => listener(payload));
      return;
    }

    const queue = this.buffered.get(key) ?? [];
    queue.push(payload);
    if (queue.length > MAX_BUFFERED_MESSAGES) queue.shift();
    this.buffered.set(key, queue);
  }

  // 화면이 닫히면 그 화면 앞으로 쌓인 메시지를 버린다.
  dropSurface(surfaceId: string) {
    for (const key of this.buffered.keys()) {
      if (key.startsWith(`${surfaceId}\u0000`)) this.buffered.delete(key);
    }
  }
}

let channel: Channel | null = null;

export function getChannel(): Channel {
  channel ??= new Channel();
  return channel;
}
