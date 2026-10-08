import { describe, expect, it } from "vitest";
import { alphaStats, alphaV5, resizePremultiplied } from "./alpha-v5";

function square(W: number, H: number, halo = false) {
  const d = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const o = (y * W + x) * 4;
    const inside = x >= 3 && x < W - 3 && y >= 3 && y < H - 3;
    const ring = x >= 2 && x < W - 2 && y >= 2 && y < H - 2 && !inside;
    if (inside) d.set([200, 40, 40, 255], o);
    else if (halo && ring) d.set([255, 255, 255, 90], o); // halo branco
    else d.set([255, 255, 255, 0], o); // branco escondido no alpha 0
  }
  return { data: d, width: W, height: H };
}

describe("alphaV5", () => {
  it("interior opaco, fundo RGBA zero e franja intermediária sem branco", () => {
    const out = alphaV5(square(12, 12, true));
    const px = (x: number, y: number) => Array.from(out.data.slice((y * 12 + x) * 4, (y * 12 + x) * 4 + 4));
    expect(px(6, 6)).toEqual([200, 40, 40, 255]);
    expect(px(0, 0)).toEqual([0, 0, 0, 0]);
    const edge = px(2, 6);
    expect(edge[3]).toBeGreaterThan(0);
    expect(edge[3]).toBeLessThan(255);
    expect(edge.slice(0, 3)).toEqual([200, 40, 40]); // cor descontaminada
    expect(out.width).toBe(12);
    expect(alphaStats(out).edgeMid).toBe(1);
  });

  it("resize premultiplicado não puxa cor do fundo transparente", () => {
    const r = resizePremultiplied(alphaV5(square(12, 12)), 6, 6);
    for (let i = 0; i < r.data.length; i += 4) {
      if (r.data[i + 3] > 0) expect([r.data[i], r.data[i + 1], r.data[i + 2]]).toEqual([200, 40, 40]);
    }
  });
});
