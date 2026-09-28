import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  MediaContextController,
  PRIVATE_ROOM_CONFIRM_MS,
  type ResolvedZone,
  type SelfPosition,
} from "../media-context";

// Mapa fake: por versão, faixas de x → zona.
// v1: x<0.3 lobby, 0.3–0.6 sala A, >=0.6 sala B. v2: sala A vira aberta.
function makeResolver() {
  const calls: Array<{ pos: SelfPosition; v: number }> = [];
  const resolve = (pos: SelfPosition, v: number): ResolvedZone => {
    calls.push({ pos, v });
    if (pos.x < 0.3) return { id: "lobby", isPrivate: false };
    if (pos.x < 0.6) return { id: "A", isPrivate: v === 1 };
    return { id: "B", isPrivate: true };
  };
  return { resolve, calls };
}

const LOBBY_P = { x: 0.1, y: 0.5 };
const A_P = { x: 0.4, y: 0.5 };
const B_P = { x: 0.8, y: 0.5 };

function ready(v = 1) {
  return { state: "READY" as const, version: v };
}

let ctl: MediaContextController;
let r: ReturnType<typeof makeResolver>;

beforeEach(() => {
  vi.useFakeTimers();
  r = makeResolver();
  ctl = new MediaContextController({ resolveZone: r.resolve });
});
afterEach(() => {
  ctl.dispose();
  vi.useRealTimers();
});

function active(v = 1) {
  ctl.setSession("ACTIVE");
  ctl.setMap(ready(v));
}

describe("MediaContextController", () => {
  it("1. sessão inativa → OFFLINE", () => {
    ctl.setMap(ready());
    ctl.setSelfPosition(A_P);
    for (const s of ["IDLE", "CLAIMING", "REPLACED", "ERROR"] as const) {
      ctl.setSession(s);
      expect(ctl.getSnapshot().context).toEqual({ kind: "OFFLINE" });
    }
  });

  it("2. mapa não READY → WAITING_FOR_MAP", () => {
    ctl.setSession("ACTIVE");
    ctl.setMap({ state: "LOADING", version: 0 });
    expect(ctl.getSnapshot().state).toBe("WAITING_FOR_MAP");
  });

  it("3. usuário no lobby → LOBBY", () => {
    active();
    ctl.setSelfPosition(LOBBY_P);
    expect(ctl.getSnapshot()).toMatchObject({ state: "LOBBY", context: { kind: "LOBBY" } });
  });

  it("4. entrada estável por 300 ms → PRIVATE_ROOM", () => {
    active();
    ctl.setSelfPosition(A_P);
    expect(ctl.getSnapshot().state).toBe("CANDIDATE_PRIVATE_ROOM");
    vi.advanceTimersByTime(PRIVATE_ROOM_CONFIRM_MS - 1);
    expect(ctl.getSnapshot().context.kind).not.toBe("PRIVATE_ROOM");
    ctl.setSelfPosition({ x: 0.41, y: 0.52 }); // move dentro da mesma sala: não reinicia
    vi.advanceTimersByTime(1);
    expect(ctl.getSnapshot().context).toEqual({ kind: "PRIVATE_ROOM", zoneId: "A" });
  });

  it("5. entrar e sair antes de 300 ms não confirma", () => {
    active();
    ctl.setSelfPosition(A_P);
    vi.advanceTimersByTime(150);
    ctl.setSelfPosition(LOBBY_P);
    vi.advanceTimersByTime(1000);
    expect(ctl.getSnapshot().context).toEqual({ kind: "LOBBY" });
  });

  it("6. sala A → lobby durante candidatura cancela A", () => {
    active();
    ctl.setSelfPosition(A_P);
    ctl.setSelfPosition(LOBBY_P);
    expect(ctl.getSnapshot().candidate).toBeNull();
    expect(ctl.pendingTimers()).toBe(0);
  });

  it("7. sala A → sala B rapidamente termina somente em B", () => {
    active();
    const seen: string[] = [];
    ctl.subscribe((s) => s.context.kind === "PRIVATE_ROOM" && seen.push(s.context.zoneId));
    ctl.setSelfPosition(A_P);
    vi.advanceTimersByTime(100);
    ctl.setSelfPosition(B_P);
    vi.advanceTimersByTime(1000);
    expect(ctl.getSnapshot().context).toEqual({ kind: "PRIVATE_ROOM", zoneId: "B" });
    expect(seen).toEqual(["B"]);
  });

  it("8. mapVersion muda durante candidatura e invalida a decisão", () => {
    active(1);
    ctl.setSelfPosition(A_P);
    vi.advanceTimersByTime(200);
    ctl.setMap(ready(2)); // em v2, A é aberta
    vi.advanceTimersByTime(1000);
    expect(ctl.getSnapshot().context).toEqual({ kind: "LOBBY" });
    expect(r.calls.at(-1)!.v).toBe(2);
  });

  it("9. SYNCING bloqueia confirmação", () => {
    active();
    ctl.setSelfPosition(A_P);
    ctl.setMap({ state: "SYNCING", version: 1 });
    vi.advanceTimersByTime(1000);
    expect(ctl.getSnapshot().state).toBe("WAITING_FOR_MAP");
    expect(ctl.getSnapshot().context.kind).not.toBe("PRIVATE_ROOM");
    expect(ctl.pendingTimers()).toBe(0);
  });

  it("10. volta para READY recalcula corretamente", () => {
    active();
    ctl.setSelfPosition(A_P);
    ctl.setMap({ state: "SYNCING", version: 1 });
    ctl.setSelfPosition(B_P);
    ctl.setMap(ready(2));
    expect(ctl.getSnapshot().state).toBe("CANDIDATE_PRIVATE_ROOM");
    vi.advanceTimersByTime(PRIVATE_ROOM_CONFIRM_MS);
    expect(ctl.getSnapshot().context).toEqual({ kind: "PRIVATE_ROOM", zoneId: "B" });
  });

  it("11. posição de outros usuários não influencia o resultado", () => {
    active();
    ctl.setSelfPosition(A_P);
    vi.advanceTimersByTime(PRIVATE_ROOM_CONFIRM_MS);
    // A API não aceita dados de terceiros; todas as resoluções usam só a posição própria.
    expect(Object.keys(ctl).some((k) => /peer|roster|presence|livekit/i.test(k))).toBe(false);
    expect(r.calls.every((c) => c.pos.x === A_P.x || c.pos.x === 0.41)).toBe(true);
    expect(ctl.getSnapshot().context).toEqual({ kind: "PRIVATE_ROOM", zoneId: "A" });
  });

  it("12. eventos antigos não sobrescrevem contexto mais novo", () => {
    active();
    ctl.setSelfPosition(A_P);
    vi.advanceTimersByTime(PRIVATE_ROOM_CONFIRM_MS);
    ctl.setSelfPosition(LOBBY_P);
    vi.advanceTimersByTime(5000); // qualquer timer residual de A
    expect(ctl.getSnapshot().context).toEqual({ kind: "LOBBY" });
  });

  it("13. cleanup cancela timers", () => {
    active();
    ctl.setSelfPosition(A_P);
    expect(ctl.pendingTimers()).toBe(1);
    ctl.dispose();
    expect(ctl.pendingTimers()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("14. double setup / StrictMode não cria timers duplicados", () => {
    active();
    ctl.setSession("ACTIVE");
    ctl.setMap(ready(1));
    ctl.setSelfPosition(A_P);
    ctl.setSelfPosition(A_P);
    expect(vi.getTimerCount()).toBe(1);
    // setup → cleanup → setup
    ctl.dispose();
    ctl = new MediaContextController({ resolveZone: r.resolve });
    active();
    ctl.setSelfPosition(A_P);
    expect(vi.getTimerCount()).toBe(1);
  });

  it("15. candidatura antiga nunca confirma depois de uma mais nova", () => {
    active();
    const seen: string[] = [];
    ctl.subscribe((s) => s.context.kind === "PRIVATE_ROOM" && seen.push(s.context.zoneId));
    ctl.setSelfPosition(A_P);
    vi.advanceTimersByTime(299);
    ctl.setSelfPosition(B_P);
    vi.advanceTimersByTime(1); // momento em que A confirmaria
    expect(ctl.getSnapshot().context.kind).not.toBe("PRIVATE_ROOM");
    vi.advanceTimersByTime(PRIVATE_ROOM_CONFIRM_MS);
    expect(seen).toEqual(["B"]);
  });

  it("resolver lançando erro → ERROR", () => {
    ctl = new MediaContextController({
      resolveZone: () => {
        throw new Error("boom");
      },
    });
    active();
    ctl.setSelfPosition(A_P);
    expect(ctl.getSnapshot()).toMatchObject({ state: "ERROR", error: "boom" });
  });
});
