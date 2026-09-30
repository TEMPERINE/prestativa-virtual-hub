#!/usr/bin/env python3
"""Gera cinco quadros do sino a partir da imagem de repouso.

O suporte e a argola escura ficam fixos; somente a peça dourada gira
em torno da haste. Todos os quadros têm o mesmo canvas para não saltarem.
"""
from pathlib import Path
from PIL import Image, ImageDraw


SOURCE = Path("src/assets/props/bell-meta-rest-source.png")
OUT = SOURCE.parent
rest = Image.open(SOURCE).convert("RGBA")
canvas = (320, 300)
base = Image.new("RGBA", canvas)
base.alpha_composite(rest, (40, 50))

mask = Image.new("L", canvas, 0)
ImageDraw.Draw(mask).polygon(
    [(166, 153), (181, 153), (184, 167), (202, 180),
     (280, 180), (280, 300), (90, 300), (90, 180),
     (148, 180), (162, 167)],
    fill=255,
)
bell = Image.new("RGBA", canvas)
bell.paste(base, (0, 0), mask)
bracket = base.copy()
bracket.paste((0, 0, 0, 0), (0, 0), mask)

for index, angle in enumerate((0, -32, -16, 16, 32), 1):
    moving = bell.rotate(angle, resample=Image.Resampling.BICUBIC, center=(173, 153))
    frame = Image.alpha_composite(moving, bracket)
    frame.save(OUT / f"bell-meta-{index}.png")
    print(f"bell-meta-{index}.png: {frame.size}")