/**
 * RTC v2 — Etapa 12: montagem StrictMode-safe do runtime.
 *
 * O runtime só é criado depois de um tick. Em StrictMode (setup → cleanup →
 * setup síncronos) o primeiro setup é cancelado antes de abrir qualquer canal
 * ou Room, então existe no máximo UM runtime vivo por vez.
 */
export interface Disposable {
  start(): void;
  dispose(): Promise<void> | void;
}

export interface MountTimers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(h: unknown): void;
}

const defaultTimers: MountTimers = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (h) => globalThis.clearTimeout(h as ReturnType<typeof setTimeout>),
};

export function mountDeferred<T extends Disposable>(
  create: () => T | Promise<T>,
  onReady: (rt: T) => void,
  timers: MountTimers = defaultTimers,
): () => void {
  let cancelled = false;
  let rt: T | null = null;
  const handle = timers.setTimeout(() => {
    void (async () => {
      const created = await create();
      if (cancelled) {
        await created.dispose();
        return;
      }
      rt = created;
      rt.start();
      onReady(rt);
    })();
  }, 0);
  return () => {
    cancelled = true;
    timers.clearTimeout(handle);
    const cur = rt;
    rt = null;
    if (cur) void cur.dispose();
  };
}
