// Fase 2 (experimental) — tratamento de alpha/borda "V5".
// Algoritmo IDÊNTICO ao de scripts/alpha_v5.py (mesma aritmética inteira),
// verificado por teste de paridade. Não altera desenho, cores internas,
// dimensões, poses nem número de frames: só reconstrói a franja externa.
//
// 1. Máscara sólida S = alpha >= 128 (a silhueta atual, sem crescer/encolher).
// 2. Cobertura = média 3×3 de S → interior 255, fundo 0, franja ~1 px de cada
//    lado do contorno (isolinha 50% fica exatamente onde a borda já estava).
// 3. Fundo (cobertura 0) vira RGBA 0,0,0,0 — sem branco residual escondido.
// 4. Franja: RGB substituído pela média dos pixels originais 100% opacos de S
//    num raio de 2 px (descontaminação) — remove halo claro/escuro herdado do
//    fundo branco sem desenhar contorno novo.
// 5. Resize opcional sempre em alpha premultiplicado (área), nunca Lanczos em
//    RGBA não premultiplicado.

export type RGBA = { data: Uint8Array | Uint8ClampedArray; width: number; height: number };

const SOLID_T = 128;
const DECON_R = 2;

export function alphaV5(src: RGBA): RGBA {
  const { width: W, height: H, data: d } = src;
  const N = W * H;
  const S = new Uint8Array(N);
  for (let i = 0; i < N; i++) S[i] = d[i * 4 + 3] >= SOLID_T ? 1 : 0;
  const out = new Uint8Array(N * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      let sum = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= H) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= W) continue;
          sum += S[yy * W + xx];
        }
      }
      const o = i * 4;
      if (sum === 0) continue; // fundo: 0,0,0,0
      const a = Math.floor((sum * 255 + 4) / 9);
      if (sum === 9) {
        out[o] = d[o];
        out[o + 1] = d[o + 1];
        out[o + 2] = d[o + 2];
        out[o + 3] = 255;
        continue;
      }
      // franja: descontamina cor
      let r = 0, g = 0, b = 0, n = 0;
      for (let dy = -DECON_R; dy <= DECON_R; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= H) continue;
        for (let dx = -DECON_R; dx <= DECON_R; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= W) continue;
          const j = (yy * W + xx) * 4;
          if (d[j + 3] !== 255) continue;
          r += d[j]; g += d[j + 1]; b += d[j + 2]; n++;
        }
      }
      if (n === 0) {
        for (let dy = -DECON_R; dy <= DECON_R; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= H) continue;
          for (let dx = -DECON_R; dx <= DECON_R; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= W) continue;
            const k = yy * W + xx;
            if (!S[k]) continue;
            const j = k * 4;
            r += d[j]; g += d[j + 1]; b += d[j + 2]; n++;
          }
        }
      }
      const h = n >> 1;
      out[o] = Math.floor((r + h) / n);
      out[o + 1] = Math.floor((g + h) / n);
      out[o + 2] = Math.floor((b + h) / n);
      out[o + 3] = a;
    }
  }
  return { data: out, width: W, height: H };
}

/** Resize por área com alpha premultiplicado (downscale e upscale). */
export function resizePremultiplied(src: RGBA, outW: number, outH: number): RGBA {
  const { width: W, height: H, data: d } = src;
  const out = new Uint8Array(outW * outH * 4);
  const sx = W / outW, sy = H / outH;
  for (let oy = 0; oy < outH; oy++) {
    const y0 = oy * sy, y1 = y0 + sy;
    for (let ox = 0; ox < outW; ox++) {
      const x0 = ox * sx, x1 = x0 + sx;
      let pr = 0, pg = 0, pb = 0, pa = 0, wt = 0;
      for (let y = Math.floor(y0); y < Math.min(H, Math.ceil(y1)); y++) {
        const wy = Math.min(y + 1, y1) - Math.max(y, y0);
        if (wy <= 0) continue;
        for (let x = Math.floor(x0); x < Math.min(W, Math.ceil(x1)); x++) {
          const wx = Math.min(x + 1, x1) - Math.max(x, x0);
          if (wx <= 0) continue;
          const w = wx * wy;
          const j = (y * W + x) * 4;
          const a = d[j + 3] / 255;
          pr += d[j] * a * w; pg += d[j + 1] * a * w; pb += d[j + 2] * a * w;
          pa += a * w; wt += w;
        }
      }
      const o = (oy * outW + ox) * 4;
      if (pa <= 0 || wt <= 0) continue;
      const A = pa / wt;
      out[o] = Math.min(255, Math.floor(pr / pa + 0.5));
      out[o + 1] = Math.min(255, Math.floor(pg / pa + 0.5));
      out[o + 2] = Math.min(255, Math.floor(pb / pa + 0.5));
      out[o + 3] = Math.min(255, Math.floor(A * 255 + 0.5));
    }
  }
  return { data: out, width: outW, height: outH };
}

export type AlphaStats = { zero: number; full: number; mid: number; edgeMid: number; edgeCount: number };

/** % alpha 0/255/intermediário e fração intermediária entre pixels de borda (vizinhos de alpha 0). */
export function alphaStats(img: RGBA): AlphaStats {
  const { width: W, height: H, data: d } = img;
  let z = 0, f = 0, m = 0, ec = 0, em = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const a = d[(y * W + x) * 4 + 3];
    if (a === 0) z++; else if (a === 255) f++; else m++;
    if (a === 0) continue;
    let edge = false;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= W || yy >= H || d[(yy * W + xx) * 4 + 3] === 0) edge = true;
    }
    if (edge) { ec++; if (a < 255) em++; }
  }
  const N = W * H;
  return { zero: z / N, full: f / N, mid: m / N, edgeMid: ec ? em / ec : 0, edgeCount: ec };
}
