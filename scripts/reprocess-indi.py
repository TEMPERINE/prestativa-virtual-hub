#!/usr/bin/env python3
"""Reprocess the 4 existing Indi sheets so that all facings render at the
same character size, are aligned on feet baseline + horizontal center, and
have white halo / edge fringe removed.

We can't run process-skin-sheet.py because Indi has 4 separate sheets, not
one grid source. This script applies the same algorithm per-sheet and then
normalizes character height across facings using the median across all
frames as the target.
"""
from __future__ import annotations
import os, sys, numpy as np
from PIL import Image
from scipy import ndimage

sys.path.insert(0, os.path.dirname(__file__))
# Reuse helpers
import importlib.util
spec = importlib.util.spec_from_file_location("psh", os.path.join(os.path.dirname(__file__), "process-skin-sheet.py"))
psh = importlib.util.module_from_spec(spec); spec.loader.exec_module(psh)

remove_white_bg = psh.remove_white_bg
bbox = psh.bbox
robust_center_x = psh.robust_center_x
ALPHA_T = psh.ALPHA_T

FRAMES = 6
SKIN = "indi"
SRC_DIR = "src/assets/sprites"
FACINGS = ["down", "up", "left", "right"]


def load_frames(facing: str):
    path = os.path.join(SRC_DIR, f"{SKIN}-{facing}.png")
    img = Image.open(path).convert("RGBA")
    arr = remove_white_bg(np.array(img))
    H, W = arr.shape[:2]
    cell_w = W // FRAMES
    frames = []
    bleed_x = int(cell_w * 0.08)
    for c in range(FRAMES):
        x0 = max(0, c * cell_w - bleed_x)
        x1 = min(W, (c + 1) * cell_w + bleed_x)
        cell = arr[:, x0:x1].copy()
        bb = bbox(cell[..., 3])
        if bb is None:
            frames.append(None); continue
        bx0, by0, bx1, by1 = bb
        crop = cell[by0:by1, bx0:bx1]
        mask = crop[..., 3] > ALPHA_T
        cx = robust_center_x(mask)
        foot_y = crop.shape[0]
        frames.append((crop, cx, foot_y))
    return frames


def main():
    facing_frames = {f: load_frames(f) for f in FACINGS}

    # Normalize heights across all facings
    all_h = [f[2] for fs in facing_frames.values() for f in fs if f is not None]
    target_h = float(np.median(all_h))
    print(f"target median height: {target_h:.1f}")
    for facing, frames in facing_frames.items():
        hs = [f[2] for f in frames if f is not None]
        cur = float(np.median(hs))
        scale = target_h / cur if cur > 0 else 1.0
        print(f"  {facing}: median={cur:.1f}  scale={scale:.3f}")
        if abs(scale - 1.0) < 0.02:
            continue
        for i, fr in enumerate(frames):
            if fr is None: continue
            crop, cx, foot_y = fr
            nw = max(1, int(round(crop.shape[1] * scale)))
            nh = max(1, int(round(crop.shape[0] * scale)))
            resized = np.array(Image.fromarray(crop, "RGBA").resize((nw, nh), Image.LANCZOS))
            frames[i] = (resized, cx * scale, foot_y * scale)

    # Now compute a UNIFORM cell size across ALL facings so dims match
    all_left = max(int(np.ceil(f[1])) for fs in facing_frames.values() for f in fs if f is not None)
    all_right = max(int(np.ceil(f[0].shape[1] - f[1])) for fs in facing_frames.values() for f in fs if f is not None)
    all_above = max(int(np.ceil(f[2])) for fs in facing_frames.values() for f in fs if f is not None)

    pad_x, pad_top, pad_bottom = 6, 6, 6
    out_cw = all_left + all_right + pad_x * 2
    out_ch = all_above + pad_top + pad_bottom
    if out_cw % 2: out_cw += 1
    if out_ch % 2: out_ch += 1
    print(f"uniform cell: {out_cw}x{out_ch}")

    for facing, frames in facing_frames.items():
        sheet = np.zeros((out_ch, out_cw * FRAMES, 4), dtype=np.uint8)
        first_real = next((f for f in frames if f is not None), None)
        frames = [f if f is not None else first_real for f in frames]
        for c, fr in enumerate(frames):
            if fr is None: continue
            crop, cx, foot_y = fr
            ch, cw = crop.shape[:2]
            cell_cx = out_cw // 2
            dst_x = c * out_cw + cell_cx - int(round(cx))
            baseline = out_ch - pad_bottom
            dst_y = baseline - int(round(foot_y))
            sx0 = max(0, -dst_x); sy0 = max(0, -dst_y)
            dx0 = max(0, dst_x);  dy0 = max(0, dst_y)
            pw = min(cw - sx0, out_cw * FRAMES - dx0)
            ph = min(ch - sy0, out_ch - dy0)
            if pw <= 0 or ph <= 0: continue
            region = sheet[dy0:dy0+ph, dx0:dx0+pw]
            src = crop[sy0:sy0+ph, sx0:sx0+pw]
            a = src[..., 3:4] / 255.0
            region[:] = (src * a + region * (1 - a)).astype(np.uint8)
            region[..., 3] = np.maximum(region[..., 3], src[..., 3])
        out_path = os.path.join(SRC_DIR, f"{SKIN}-{facing}.png")
        Image.fromarray(sheet, "RGBA").save(out_path, optimize=True)
        print(f"  wrote {out_path}  sheet={out_cw*FRAMES}x{out_ch}")

    print(f"\nUpdate sprite-catalog dims for indi: all facings -> w:{out_cw} h:{out_ch}")


if __name__ == "__main__":
    main()
