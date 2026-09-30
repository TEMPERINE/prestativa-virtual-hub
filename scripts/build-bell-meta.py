#!/usr/bin/env python3
"""Gera os frames do "Sino Meta" (bell-meta-1..5.png).

Estratégia: sino e suporte são imagens separadas. O suporte fica 100% fixo
em todos os frames; o sino é rotacionado em torno do ponto de pivô (gancho
do suporte). Assim o balanço é geometricamente correto e bem visível.

Frames (ordem no catálogo):
  0 = repouso (0°)   1 = -18°   2 = -9°   3 = +9°   4 = +18°
"""
from PIL import Image
import numpy as np
import os

SRC = "src/assets/props"
BELL = os.path.join(SRC, "bell-meta-source-bell.png")
BRACKET = os.path.join(SRC, "bell-meta-source-bracket.png")

ANGLES = [0, -18, -9, 9, 18]  # frame 0..4


def crop_alpha(im, thresh=12):
    a = np.array(im)[:, :, 3]
    ys, xs = np.nonzero(a > thresh)
    return im.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))


bell = crop_alpha(Image.open(BELL).convert("RGBA"))
bracket = crop_alpha(Image.open(BRACKET).convert("RGBA"))

# --- ponto do gancho no suporte: pixel mais baixo dentro dos 12% de colunas
# mais à direita do conteúdo (o pequeno gancho/argola na ponta do braço).
ba = np.array(bracket)[:, :, 3] > 12
W, H = bracket.size
right_cols = ba[:, int(W * 0.88):]
ys, xs = np.nonzero(right_cols)
hook_x = int(W * 0.88) + int(xs[ys.argmax()])
hook_y = int(ys.max())

# --- ponto de suspensão do sino: centro do anel no topo
bw, bh = bell.size
bell_alpha = np.array(bell)[:, :, 3] > 12
top_row = np.nonzero(bell_alpha[0:int(bh * 0.04)].any(axis=0))[0]
hang_x = int((top_row.min() + top_row.max()) / 2)
hang_y = int(bh * 0.03)  # um pouco abaixo do topo, dentro do anel

# --- escala do sino em relação ao suporte: sino ~95% da altura do braço útil
target_bell_h = int(H * 1.05)
scale = target_bell_h / bh
bell = bell.resize((int(bw * scale), target_bell_h), Image.LANCZOS)
hang_x = int(hang_x * scale)
hang_y = int(hang_y * scale)
bw, bh = bell.size

# --- canvas comum: suporte no topo-esquerda, espaço para o sino balançar
PAD = int(bh * 0.45)
CW = max(W, hook_x + bw) + PAD * 2
CH = hook_y + bh + PAD * 2
px, py = PAD, PAD  # posição do suporte
pivot = (px + hook_x, py + hook_y - int(bh * 0.012))  # gancho (pivô global)

frames = []
for ang in ANGLES:
    layer = Image.new("RGBA", (CW, CH), (0, 0, 0, 0))
    # camada só do sino, pendurado no pivô
    bell_layer = Image.new("RGBA", (CW, CH), (0, 0, 0, 0))
    bell_layer.paste(bell, (pivot[0] - hang_x, pivot[1] - hang_y), bell)
    if ang != 0:
        bell_layer = bell_layer.rotate(ang, resample=Image.BICUBIC, center=pivot)
    layer.alpha_composite(bell_layer)
    layer.alpha_composite(bracket, (px, py))  # suporte por cima, sempre fixo
    frames.append(layer)

# --- recorte comum (união dos bboxes de todos os frames) para canvas idêntico
mins_x, mins_y, maxs_x, maxs_y = [], [], [], []
for f in frames:
    a = np.array(f)[:, :, 3] > 12
    ys, xs = np.nonzero(a)
    mins_x.append(xs.min()); mins_y.append(ys.min())
    maxs_x.append(xs.max()); maxs_y.append(ys.max())
box = (min(mins_x), min(mins_y), max(maxs_x) + 1, max(maxs_y) + 1)

FINAL_W = 240
for i, f in enumerate(frames, 1):
    c = f.crop(box)
    ratio = FINAL_W / c.width
    c = c.resize((FINAL_W, int(c.height * ratio)), Image.LANCZOS)
    out = os.path.join(SRC, f"bell-meta-{i}.png")
    c.save(out)
    print(out, c.size)
