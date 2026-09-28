import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MovementRealtime,
  movementTopic,
  type MovementEvent,
  type MovementTransport,
  type MovementTransportHandlers,
} from "@/lib/rtc/movement-realtime";

function fakeTransport() {
  const opened: { handlers: MovementTransportHandlers; sent: MovementEvent[]; closed: boolean }[] =
    [];
  const transport: MovementTransport = {
    open(handlers) {
      const entry = { handlers, sent: [] as MovementEvent[], closed: false };
      opened.push(entry);
      return {
        send: (e) => entry.sent.push(e),
        close: () => {
          entry.closed = true;
        },
      };
    },
  };
  const all = () => opened.flatMap((o) => o.sent);
  return { transport, opened, all };
}

const self = { userId: "me", sessionId: "s-me", generation: 1 };
const ev = (p: Partial<MovementEvent>): MovementEvent => ({
  type: "MOTION_START",
  userId: "u2",
  sessionId: "s2",
  generation: 1,
  seq: 1,
  x: 0.5,
  y: 0.5,
  vx: 0.1,
  vy: 0,
  ...p,
});

function setup() {
  const t = fakeTransport();
  const m = new MovementRealtime({ self, transport: t.transport });
  m.start();
  t.opened[0].handlers.onSubscribed(false);
  return { m, t, h: () => t.opened[t.opened.length - 1].handlers };
}
const types = (es: MovementEvent[]) => es.map((e) => e.type);

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("MovementRealtime", () => {
  it("topic", () => expect(movementTopic("w")).toBe("workspace:w:movement"));

  it("1. entrar envia um único SNAPSHOT_REQUEST", () => {
    const { t } = setup();
    vi.advanceTimersByTime(10_000);
    expect(types(t.all())).toEqual(["SNAPSHOT_REQUEST"]);
  });

  it("2. MOTION_START imediato", () => {
    const { m, t } = setup();
    m.updateLocal(0.1, 0.1, 0.2, 0);
    expect(types(t.all()).at(-1)).toBe("MOTION_START");
    expect(t.all().at(-1)).toMatchObject({
      x: 0.1,
      y: 0.1,
      vx: 0.2,
      vy: 0,
      generation: 1,
      sessionId: "s-me",
    });
  });

  it("3/19. 60 FPS contínuo não gera broadcast por frame", () => {
    const { m, t } = setup();
    for (let i = 0; i < 60; i++) {
      m.updateLocal(0.1 + i * 0.001, 0.1, 0.06, 0);
      vi.advanceTimersByTime(16);
    }
    // 1 request + 1 start (menos de 1s → nenhum sync ainda)
    expect(t.all().length).toBeLessThanOrEqual(3);
  });

  it("4. MOTION_CHANGE quando o vetor muda", () => {
    const { m, t } = setup();
    m.updateLocal(0, 0, 1, 0);
    m.updateLocal(0.01, 0, 1.01, 0.01); // pequena variação
    expect(types(t.all())).not.toContain("MOTION_CHANGE");
    m.updateLocal(0.02, 0, 0, 1);
    expect(types(t.all()).at(-1)).toBe("MOTION_CHANGE");
  });

  it("5. MOTION_STOP com posição final exata", () => {
    const { m, t } = setup();
    m.updateLocal(0, 0, 1, 0);
    m.updateLocal(0.4321, 0.1234, 0, 0);
    expect(t.all().at(-1)).toMatchObject({
      type: "MOTION_STOP",
      x: 0.4321,
      y: 0.1234,
      vx: 0,
      vy: 0,
      moving: false,
    });
  });

  it("6. POSITION_SYNC ~1/s enquanto move", () => {
    const { m, t } = setup();
    m.updateLocal(0, 0, 1, 0);
    vi.advanceTimersByTime(3000);
    expect(types(t.all()).filter((x) => x === "POSITION_SYNC")).toHaveLength(3);
  });

  it("7. parado não gera POSITION_SYNC", () => {
    const { m, t } = setup();
    m.updateLocal(0, 0, 1, 0);
    m.updateLocal(0, 0, 0, 0);
    vi.advanceTimersByTime(5000);
    expect(types(t.all())).not.toContain("POSITION_SYNC");
  });

  it("8/9. snapshot responde só o próprio estado e não gera loop", () => {
    const { m, t, h } = setup();
    m.updateLocal(0.3, 0.4, 0, 0);
    h().onEvent(ev({ type: "SNAPSHOT_REQUEST", x: undefined, y: undefined }));
    const snaps = t.all().filter((e) => e.type === "POSITION_SNAPSHOT");
    expect(snaps).toHaveLength(1);
    expect(snaps[0]).toMatchObject({ userId: "me", x: 0.3, y: 0.4, moving: false });
    h().onEvent(ev({ type: "POSITION_SNAPSHOT", seq: 2 }));
    expect(types(t.all()).filter((x) => x === "SNAPSHOT_REQUEST")).toHaveLength(1);
    expect(types(t.all()).filter((x) => x === "POSITION_SNAPSHOT")).toHaveLength(1);
    expect(m.getRemoteStates().get("u2")?.x).toBe(0.5);
  });

  it("10/11/12. seq antigo/igual ignorado, maior aceito", () => {
    const { m, h } = setup();
    h().onEvent(ev({ seq: 5, x: 0.5 }));
    h().onEvent(ev({ seq: 4, x: 0.1, type: "POSITION_SYNC" }));
    expect(m.getRemoteStates().get("u2")?.x).toBe(0.5);
    h().onEvent(ev({ seq: 5, x: 0.2, type: "POSITION_SYNC" }));
    expect(m.getRemoteStates().get("u2")?.x).toBe(0.5);
    h().onEvent(ev({ seq: 6, x: 0.7, type: "POSITION_SYNC" }));
    expect(m.getRemoteStates().get("u2")).toMatchObject({ x: 0.7, seq: 6 });
  });

  it("13/14. generation maior substitui; velha ignorada depois", () => {
    const { m, h } = setup();
    h().onEvent(ev({ seq: 50, x: 0.1 }));
    h().onEvent(ev({ generation: 2, sessionId: "s2b", seq: 1, x: 0.9 }));
    expect(m.getRemoteStates().get("u2")).toMatchObject({
      generation: 2,
      sessionId: "s2b",
      seq: 1,
      x: 0.9,
    });
    h().onEvent(ev({ generation: 1, seq: 99, x: 0.0 }));
    expect(m.getRemoteStates().get("u2")?.x).toBe(0.9);
  });

  it("15. sequências independentes por usuário", () => {
    const { m, h } = setup();
    h().onEvent(ev({ userId: "a", sessionId: "sa", seq: 10 }));
    h().onEvent(ev({ userId: "b", sessionId: "sb", seq: 1 }));
    expect(m.getRemoteStates().get("b")?.seq).toBe(1);
  });

  it("16. dispose cancela timers", async () => {
    const { m, t } = setup();
    m.updateLocal(0, 0, 1, 0);
    await m.dispose();
    const n = t.all().length;
    vi.advanceTimersByTime(5000);
    expect(t.all().length).toBe(n);
    expect(vi.getTimerCount()).toBe(0);
    expect(t.opened[0].closed).toBe(true);
  });

  it("17/18. canal antigo ignorado; restart pede um novo snapshot", async () => {
    const { m, t } = setup();
    const oldHandlers = t.opened[0].handlers;
    await m.restart();
    oldHandlers.onEvent(ev({ seq: 1 }));
    expect(m.getRemoteStates().size).toBe(0);
    t.opened[1].handlers.onSubscribed(false);
    expect(t.opened[1].sent.map((e) => e.type)).toEqual(["SNAPSHOT_REQUEST"]);
  });

  it("18b. reconexão do mesmo canal pede exatamente um snapshot por SUBSCRIBED", () => {
    const { t, h } = setup();
    h().onSubscribed(true);
    expect(types(t.all()).filter((x) => x === "SNAPSHOT_REQUEST")).toHaveLength(2);
  });

  it("ignora eventos próprios e seq local monotônico", () => {
    const { m, t, h } = setup();
    h().onEvent(ev({ userId: "me" }));
    expect(m.getRemoteStates().size).toBe(0);
    m.updateLocal(0, 0, 1, 0);
    m.updateLocal(0, 0, 0, 0);
    const seqs = t.all().map((e) => e.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(new Set(seqs).size).toBe(seqs.length);
  });

  it("20. Movement nunca usa Presence.track()", async () => {
    const src = (await import("node:fs")).readFileSync("src/lib/rtc/movement-realtime.ts", "utf8");
    expect(src).not.toMatch(/\.track\(/);
    expect(src).not.toMatch(/presence\s*:/);
  });

  it("volume: 60 s a 60 FPS em linha reta", () => {
    const { m, t } = setup();
    for (let f = 0; f < 60 * 60; f++) {
      m.updateLocal(0.1 + f * 0.0001, 0.2, 0.006, 0);
      vi.advanceTimersByTime(1000 / 60);
    }
    m.updateLocal(0.46, 0.2, 0, 0);
    const c = (k: string) => types(t.all()).filter((x) => x === k).length;
    const counts = {
      total: t.all().length,
      start: c("MOTION_START"),
      change: c("MOTION_CHANGE"),
      sync: c("POSITION_SYNC"),
      stop: c("MOTION_STOP"),
      request: c("SNAPSHOT_REQUEST"),
    };
    console.info("[volume 60s]", JSON.stringify(counts));
    expect(counts.start).toBe(1);
    expect(counts.change).toBe(0);
    expect(counts.stop).toBe(1);
    expect(counts.sync).toBeGreaterThanOrEqual(59);
    expect(counts.sync).toBeLessThanOrEqual(61);
    expect(counts.total).toBeLessThan(70);
  });
});
