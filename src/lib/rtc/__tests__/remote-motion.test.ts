import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { RemoteMotionPredictor, REMOTE_MOTION, facingFromVector } from "@/lib/rtc/remote-motion";
import {
  MovementRealtime,
  type MovementEvent,
  type MovementTransport,
  type MovementTransportHandlers,
} from "@/lib/rtc/movement-realtime";

const V = 0.0042 * 60; // SPEED_PER_SEC do OfficeScene (frações/s)

function pair() {
  const handlers: MovementTransportHandlers[] = [];
  const sent: MovementEvent[] = [];
  const transport: MovementTransport = {
    open(h) {
      handlers.push(h);
      return {
        send: (e) => {
          sent.push(e);
          handlers.forEach((x) => x !== h && x.onEvent(e));
        },
        close: () => {},
      };
    },
  };
  const a = new MovementRealtime({
    self: { userId: "a", sessionId: "sa", generation: 1 },
    transport,
  });
  const b = new MovementRealtime({
    self: { userId: "b", sessionId: "sb", generation: 1 },
    transport,
  });
  a.start();
  b.start();
  handlers.forEach((h) => h.onSubscribed(false));
  const pred = new RemoteMotionPredictor();
  b.subscribe((m) => {
    const s = m.get("a");
    if (s) pred.ingest(s, Date.now());
  });
  return { a, b, pred, sent };
}

const base = { userId: "a", sessionId: "s", generation: 1 };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});
afterEach(() => vi.useRealTimers());

describe("RemoteMotionPredictor", () => {
  it("1/2/3. START avança antes de SYNC, contínuo, 1s sem sync não congela", () => {
    const p = new RemoteMotionPredictor();
    p.ingest({ ...base, seq: 1, x: 0.1, y: 0.2, vx: V, vy: 0, moving: true }, 0);
    const xs = [16, 500, 1000, 1500].map((t) => p.sample("a", t)!.x);
    expect(xs[0]).toBeGreaterThan(0.1);
    for (let i = 1; i < xs.length; i++) expect(xs[i]).toBeGreaterThan(xs[i - 1]);
    expect(xs[3]).toBeCloseTo(0.1 + V * 1.5, 6);
  });

  it("4/5/13. SYNC com drift pequeno: sem snap, converge, não é jump", () => {
    const p = new RemoteMotionPredictor();
    p.ingest({ ...base, seq: 1, x: 0.1, y: 0.2, vx: V, vy: 0, moving: true }, 0);
    const before = p.sample("a", 1000)!.x;
    const r = p.ingest(
      { ...base, seq: 2, x: before + 0.01, y: 0.2, vx: V, vy: 0, moving: true },
      1000,
    );
    expect(r).toBe("correction");
    expect(Math.abs(p.sample("a", 1000)!.x - before)).toBeLessThan(1e-9);
    expect(p.sample("a", 1600)!.x).toBeCloseTo(before + 0.01 + V * 0.6, 3);
  });

  it("6/11. CHANGE muda trajetória sem salto e direção acompanha vetor", () => {
    const p = new RemoteMotionPredictor();
    p.ingest({ ...base, seq: 1, x: 0.1, y: 0.2, vx: V, vy: 0, moving: true }, 0);
    const b = p.sample("a", 300)!;
    p.ingest({ ...base, seq: 2, x: b.x, y: b.y, vx: 0, vy: V, moving: true }, 300);
    const c = p.sample("a", 316)!;
    expect(Math.hypot(c.x - b.x, c.y - b.y)).toBeLessThan(V * 0.02);
    expect(c.y).toBeGreaterThan(b.y);
    expect(facingFromVector(c.vx, c.vy, "left")).toBe("down");
    expect(facingFromVector(-V, 0, "down")).toBe("left");
  });

  it("7/8/10/14. STOP termina exato, idle e não deriva", () => {
    const p = new RemoteMotionPredictor();
    p.ingest({ ...base, seq: 1, x: 0.1, y: 0.2, vx: V, vy: 0, moving: true }, 0);
    p.ingest({ ...base, seq: 2, x: 0.3, y: 0.2, vx: 0, vy: 0, moving: false }, 800);
    expect(p.isMoving("a")).toBe(false);
    expect(p.sample("a", 3000)!.x).toBe(0.3);
    expect(p.sample("a", 60000)!.x).toBe(0.3);
  });

  it("9. moving=true mantém walk entre pacotes", () => {
    const p = new RemoteMotionPredictor();
    p.ingest({ ...base, seq: 1, x: 0.1, y: 0.2, vx: V, vy: 0, moving: true }, 0);
    expect(p.isMoving("a")).toBe(true);
    p.sample("a", 900);
    expect(p.isMoving("a")).toBe(true);
  });

  it("12. jump explícito é imediato", () => {
    const p = new RemoteMotionPredictor();
    p.ingest({ ...base, seq: 1, x: 0.1, y: 0.2, vx: 0, vy: 0, moving: false }, 0);
    expect(
      p.ingest({ ...base, seq: 2, x: 0.8, y: 0.8, vx: 0, vy: 0, moving: false, jump: true }, 10),
    ).toBe("jump");
    expect(p.sample("a", 10)).toMatchObject({ x: 0.8, y: 0.8 });
  });

  it("15/16. seq e generation antigos ignorados", () => {
    const p = new RemoteMotionPredictor();
    p.ingest({ ...base, seq: 5, x: 0.5, y: 0.5, vx: 0, vy: 0, moving: false }, 0);
    expect(p.ingest({ ...base, seq: 5, x: 0.1, y: 0.1, vx: 0, vy: 0, moving: false }, 1)).toBe(
      "ignored",
    );
    p.ingest({ ...base, generation: 2, seq: 1, x: 0.6, y: 0.6, vx: 0, vy: 0, moving: false }, 2);
    expect(p.ingest({ ...base, seq: 99, x: 0, y: 0, vx: 0, vy: 0, moving: false }, 3)).toBe(
      "ignored",
    );
  });

  it("17. suavização não altera posição autoritativa", () => {
    const p = new RemoteMotionPredictor();
    p.ingest({ ...base, seq: 1, x: 0.1, y: 0.2, vx: V, vy: 0, moving: true }, 0);
    p.ingest({ ...base, seq: 2, x: 0.4, y: 0.2, vx: V, vy: 0, moving: true }, 1000);
    expect(p.authoritative("a")).toEqual({ x: 0.4, y: 0.2 });
    expect(p.sample("a", 1000)!.x).not.toBe(0.4);
  });
});

describe("Movement → predictor (integração)", () => {
  it("12b/13b. announcePosition({jump}) marca jump; SYNC periódico nunca", () => {
    const { a, b, sent } = pair();
    a.updateLocal(0.1, 0.2, V, 0);
    vi.advanceTimersByTime(2000);
    expect(sent.filter((e) => e.type === "POSITION_SYNC").every((e) => !e.jump)).toBe(true);
    a.updateLocal(0.5, 0.2, 0, 0);
    a.announcePosition({ jump: true });
    expect(b.getRemoteStates().get("a")?.jump).toBe(true);
  });

  it("18/19/20 + teste visual 3s: contínuo, poucos broadcasts, proximidade no autoritativo", async () => {
    const { a, b, pred, sent } = pair();
    let x = 0.1;
    const frames: number[] = [];
    for (let f = 0; f < 180; f++) {
      x += V / 60;
      a.updateLocal(x, 0.2, V, 0);
      vi.advanceTimersByTime(1000 / 60);
      frames.push(pred.sample("a", Date.now())!.x);
    }
    a.updateLocal(x, 0.2, 0, 0);
    for (let f = 0; f < 60; f++) {
      vi.advanceTimersByTime(16);
      frames.push(pred.sample("a", Date.now())!.x);
    }
    const jumps = frames.slice(1).map((v, i) => Math.abs(v - frames[i]));
    const maxJump = Math.max(...jumps);
    const finalErr = Math.abs(frames.at(-1)! - x);
    const report = { broadcasts: sent.length, visualUpdates: frames.length, maxJump, finalErr };
    console.info("[visual 3s]", JSON.stringify(report));
    expect(sent.length).toBeLessThanOrEqual(8);
    expect(new Set(frames.slice(0, 180).map((v) => v.toFixed(5))).size).toBeGreaterThan(150);
    expect(maxJump).toBeLessThan((V / 60) * 3);
    expect(finalErr).toBeLessThan(1e-9);
    // Proximidade usa estado autoritativo do Movement, não o visual.
    expect(b.getRemoteStates().get("a")!.x).toBe(x);
    await a.dispose();
    await b.dispose();
    expect(vi.getTimerCount()).toBe(0);
    expect(REMOTE_MOTION.largeDrift).toBe(0.075);
  });

  it("predictor não cria timers/loops próprios", () => {
    const src = readFileSync("src/lib/rtc/remote-motion.ts", "utf8");
    expect(src).not.toMatch(/setInterval|setTimeout|requestAnimationFrame/);
  });
});
