#!/usr/bin/env python3
"""Fase 2 experimental — alpha/borda V5. Port 1:1 de src/lib/sprites/alpha-v5.ts
(mesma aritmética inteira; paridade verificada por teste).

Uso: python3 scripts/alpha_v5.py <entrada.png> <saida.png>
Nunca sobrescreve a entrada.
"""
import math
import sys

import numpy as np
from PIL import Image

SOLID_T = 128
DECON_R = 2


def alpha_v5(d: np.ndarray) -> np.ndarray:
    H, W, _ = d.shape
    d = d.astype(np.int64)
    S = (d[:, :, 3] >= SOLID_T).astype(np.int64)
    Sp = np.pad(S, 1)
    ssum = sum(Sp[1 + dy:1 + dy + H, 1 + dx:1 + dx + W] for dy in (-1, 0, 1) for dx in (-1, 0, 1))
    out = np.zeros((H, W, 4), np.int64)
    a = (ssum * 255 + 4) // 9
    interior = ssum == 9
    out[interior, :3] = d[interior, :3]
    out[interior, 3] = 255
    R = DECON_R
    full = (d[:, :, 3] == 255).astype(np.int64)
    fp = np.pad(full, R)
    sp = np.pad(S, R)
    cp = np.pad(d[:, :, :3], ((R, R), (R, R), (0, 0)))
    acc_f = np.zeros((H, W, 3), np.int64); n_f = np.zeros((H, W), np.int64)
    acc_s = np.zeros((H, W, 3), np.int64); n_s = np.zeros((H, W), np.int64)
    for dy in range(-R, R + 1):
        for dx in range(-R, R + 1):
            sl = (slice(R + dy, R + dy + H), slice(R + dx, R + dx + W))
            c = cp[sl]
            acc_f += c * fp[sl][:, :, None]; n_f += fp[sl]
            acc_s += c * sp[sl][:, :, None]; n_s += sp[sl]
    fringe = (ssum > 0) & (ssum < 9)
    use_f = n_f > 0
    acc = np.where(use_f[:, :, None], acc_f, acc_s)
    n = np.where(use_f, n_f, n_s)
    nn = np.maximum(n, 1)
    col = (acc + (nn >> 1)[:, :, None]) // nn[:, :, None]
    out[fringe, :3] = col[fringe]
    out[fringe, 3] = a[fringe]
    return out.astype(np.uint8)


def resize_premultiplied(d: np.ndarray, out_w: int, out_h: int) -> np.ndarray:
    H, W, _ = d.shape
    out = np.zeros((out_h, out_w, 4), np.uint8)
    sx, sy = W / out_w, H / out_h
    for oy in range(out_h):
        y0 = oy * sy; y1 = y0 + sy
        for ox in range(out_w):
            x0 = ox * sx; x1 = x0 + sx
            pr = pg = pb = pa = wt = 0.0
            for y in range(math.floor(y0), min(H, math.ceil(y1))):
                wy = min(y + 1, y1) - max(y, y0)
                if wy <= 0: continue
                for x in range(math.floor(x0), min(W, math.ceil(x1))):
                    wx = min(x + 1, x1) - max(x, x0)
                    if wx <= 0: continue
                    w = wx * wy
                    r, g, b, a8 = (int(v) for v in d[y, x])
                    a = a8 / 255
                    pr += r * a * w; pg += g * a * w; pb += b * a * w
                    pa += a * w; wt += w
            if pa <= 0 or wt <= 0: continue
            A = pa / wt
            out[oy, ox] = [min(255, math.floor(pr / pa + 0.5)), min(255, math.floor(pg / pa + 0.5)),
                           min(255, math.floor(pb / pa + 0.5)), min(255, math.floor(A * 255 + 0.5))]
    return out


def main():
    src, dst = sys.argv[1], sys.argv[2]
    if src == dst:
        sys.exit("saída não pode ser igual à entrada")
    img = np.array(Image.open(src).convert("RGBA"))
    Image.fromarray(alpha_v5(img), "RGBA").save(dst)


if __name__ == "__main__":
    main()
