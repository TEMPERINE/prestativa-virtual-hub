import { describe, expect, it } from "vitest";
import { RemoteMotionPredictor, type RemoteMotionInput } from "@/lib/rtc/remote-motion";

/** Etapa 14C — movimento remoto sob carga (frame stalls + eventos atrasados). */
const V = 0.0042 * 60;
const mk = (u: string) => ({ userId: u, sessionId: "s" + u, generation: 1 });

interface Ev { at: number; e: RemoteMotionInput }

/** Roda o render loop com stalls; retorna nº de frames com ré ao longo de +x. */
function run(p: RemoteMotionPredictor, uid: string, evs: Ev[], until: number, stalls: number[] = []) {
  const queue = [...evs].sort((a, b) => a.at - b.at);
  let t = 0;
  let last: number | null = null;
  let back = 0;
  let i = 0;
  const xs: number[] = [];
  while (t <= until) {
    const stall = stalls.includes(Math.round(t / 16)) ? 250 : 0;
    t += 16 + stall;
    // eventos chegam em lote após o stall (como no main thread ocupado)
    while (i < queue.length && queue[i].at <= t) p.ingest(queue[i++].e, t);
    const s = p.sample(uid, t);
    if (!s) continue;
    if (last !== null && s.x < last - 1e-12) back++;
    last = s.x;
    xs.push(s.x);
  }
  return { back, xs };
}

function straight(uid: string, jitter: (k: number) => number, secs = 4): Ev[] {
  const b = mk(uid);
  const out: Ev[] = [{ at: 0, e: { ...b, seq: 1, x: 0.1, y: 0.2, vx: V, vy: 0, moving: true } }];
  for (let k = 1; k <= secs; k++)
    out.push({ at: k * 1000 + jitter(k), e: { ...b, seq: k + 1, x: 0.1 + V * k, y: 0.2, vx: V, vy: 0, moving: true } });
  return out;
}

describe("movimento remoto sob carga", () => {
  for (const d of [0, 100, 250, 500]) {
    it(`SYNC atrasado ${d}ms não gera ré`, () => {
      const p = new RemoteMotionPredictor();
      expect(run(p, "a", straight("a", (k) => (k % 2 ? d : 0)), 4200).back).toBe(0);
    });
  }

  for (const stall of [100, 250, 500]) {
    it(`frame stall ${stall}ms com SYNC durante o stall: sem ré, sem multiplicar deslocamento`, () => {
      const p = new RemoteMotionPredictor();
      const r = run(p, "a", straight("a", () => 0), 3000, [60, 61]);
      expect(r.back).toBe(0);
      // posição nunca excede a trajetória real + horizonte de 1 frame
      expect(Math.max(...r.xs)).toBeLessThan(0.1 + V * 3.2);
    });
  }

  it("mudança de direção sem salto", () => {
    const p = new RemoteMotionPredictor();
    const b = mk("a");
    p.ingest({ ...b, seq: 1, x: 0.1, y: 0.2, vx: V, vy: 0, moving: true }, 0);
    const s1 = p.sample("a", 500)!;
    p.ingest({ ...b, seq: 2, x: 0.1 + V * 0.4, y: 0.2, vx: 0, vy: V, moving: true }, 500);
    const s2 = p.sample("a", 516)!;
    expect(Math.hypot(s2.x - s1.x, s2.y - s1.y)).toBeLessThan(V * 0.05);
  });

  it("STOP termina exato; SYNC antigo depois do STOP é ignorado", () => {
    const p = new RemoteMotionPredictor();
    const b = mk("a");
    p.ingest({ ...b, seq: 1, x: 0.1, y: 0.2, vx: V, vy: 0, moving: true }, 0);
    p.ingest({ ...b, seq: 3, x: 0.3, y: 0.2, vx: 0, vy: 0, moving: false }, 800);
    expect(p.ingest({ ...b, seq: 2, x: 0.25, y: 0.2, vx: V, vy: 0, moving: true }, 900)).toBe("ignored");
    expect(p.sample("a", 5000)!.x).toBe(0.3);
  });

  it("predictor não extrapola indefinidamente sem eventos", () => {
    const p = new RemoteMotionPredictor();
    p.ingest({ ...mk("a"), seq: 1, x: 0.1, y: 0.2, vx: V, vy: 0, moving: true }, 0);
    expect(p.sample("a", 60_000)!.x).toBeCloseTo(0.1 + V * 1.5, 6);
  });

  it("5 participantes simultâneos com jitter e stalls: nenhum dá ré", () => {
    const p = new RemoteMotionPredictor();
    const users = ["a", "b", "c", "d", "e"];
    const all: Ev[] = users.flatMap((u, n) => straight(u, (k) => ((k + n) % 3) * 180));
    const backs = users.map((u) => run(p, u, all.filter((x) => x.e.userId === u), 4200, [40, 90, 150]).back);
    expect(backs).toEqual([0, 0, 0, 0, 0]);
  });

  it("autoritativo permanece separado do visual", () => {
    const p = new RemoteMotionPredictor();
    p.ingest({ ...mk("a"), seq: 1, x: 0.1, y: 0.2, vx: V, vy: 0, moving: true }, 0);
    p.ingest({ ...mk("a"), seq: 2, x: 0.3, y: 0.2, vx: V, vy: 0, moving: true }, 1500);
    expect(p.authoritative("a")).toEqual({ x: 0.3, y: 0.2 });
  });
});
