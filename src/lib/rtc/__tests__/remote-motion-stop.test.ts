import { describe, expect, it } from "vitest";
import { RemoteMotionPredictor } from "../remote-motion";

const V = 0.2; // frações/s
const base = { userId: "u", sessionId: "s", generation: 1 };

function run(stopDelayMs: number) {
  const p = new RemoteMotionPredictor();
  // Remetente anda de x=0.1 a partir de t=0 e para em t=1000 (x=0.3).
  p.ingest({ ...base, seq: 1, x: 0.1, y: 0.5, vx: V, vy: 0, moving: true }, 0);
  const xs: number[] = [];
  let t = 0;
  for (; t < 1000 + stopDelayMs; t += 16) xs.push(p.sample("u", t)!.x);
  p.ingest({ ...base, seq: 2, x: 0.3, y: 0.5, vx: 0, vy: 0, moving: false }, t);
  const after: number[] = [];
  for (let k = 0; k < 200; k++) after.push(p.sample("u", t + k * 16)!.x);
  return { xs, after, p };
}

describe("STOP — sem velocidade antiga e sem salto para trás", () => {
  it("STOP pontual para exatamente no destino", () => {
    const { after } = run(0);
    expect(after.at(-1)!).toBeCloseTo(0.3, 4);
  });

  for (const d of [100, 250, 500]) {
    it(`STOP atrasado ${d} ms: sem avanço após STOP e recuo por frame imperceptível`, () => {
      const { after, p } = run(d);
      expect(p.isMoving("u")).toBe(false);
      for (let i = 1; i < after.length; i++) {
        expect(after[i]).toBeLessThanOrEqual(after[i - 1] + 1e-9); // nunca avança
        expect(after[i - 1] - after[i]).toBeLessThan(0.0035 * (d / 100)); // sem salto
      }
      expect(after.at(-1)!).toBeCloseTo(0.3, 3);
    });
  }

  it("predictor não usa velocity antiga após STOP", () => {
    const { after } = run(250);
    const settled = after.at(-1)!;
    expect(after.at(-2)! - settled).toBeLessThan(1e-4);
  });
});
