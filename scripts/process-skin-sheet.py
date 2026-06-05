#!/usr/bin/env python3
"""
Standard sprite-sheet processor for character skins.

Input: a single PNG arranged as a grid of ROWS x COLS frames.
Default layout: 4 rows (down, up, left, right) x 6 cols (idle + 5 walk frames).

Output: 4 PNG sheets (one per facing) of 6 frames each, where every frame:
  - has the white/near-white background removed (with halo cleanup)
  - is centered horizontally on the detected character center
  - is aligned vertically on the detected feet baseline
  - uses a uniform cell size per row (so the in-game renderer can step by cellW)

Usage:
  python3 scripts/process-skin-sheet.py <source.png> <skin-id> \
      [--rows 4] [--cols 6] [--out src/assets/sprites]

Facings order (top to bottom): down, up, left, right.
"""
from __future__ import annotations
import sys, os, argparse
from PIL import Image
import numpy as np

FACINGS = ["down", "up", "left", "right"]
ALPHA_T = 24          # treat as transparent below this
WHITE_T = 238         # near-white threshold for halo cleanup
HALO_ALPHA_T = 200    # only clean halo where alpha is already partial


def remove_white_bg(arr: np.ndarray) -> np.ndarray:
    """Make near-white pixels transparent and clean halo (semi-transparent whites)."""
    rgb = arr[..., :3].astype(np.int16)
    a = arr[..., 3].astype(np.int16) if arr.shape[2] == 4 else np.full(arr.shape[:2], 255, np.int16)
    # Solid white -> fully transparent
    near_white = (rgb[..., 0] >= WHITE_T) & (rgb[..., 1] >= WHITE_T) & (rgb[..., 2] >= WHITE_T)
    a = np.where(near_white, 0, a)
    # Halo cleanup: semi-transparent whitish pixels get their alpha killed too,
    # avoiding the jagged white fringe that ruined left/right frames.
    whitish = (rgb.min(axis=-1) >= 215)
    a = np.where((a < HALO_ALPHA_T) & whitish, 0, a)
    out = np.dstack([arr[..., :3], a.astype(np.uint8)])
    return out


def bbox(alpha: np.ndarray) -> tuple[int, int, int, int] | None:
    mask = alpha > ALPHA_T
    if not mask.any():
        return None
    ys = np.where(mask.any(axis=1))[0]
    xs = np.where(mask.any(axis=0))[0]
    return int(xs[0]), int(ys[0]), int(xs[-1]) + 1, int(ys[-1]) + 1


def robust_center_x(mask: np.ndarray) -> float:
    """Center of mass of opaque pixels, ignoring sparse outlier columns."""
    col_counts = mask.sum(axis=0)
    if col_counts.sum() == 0:
        return mask.shape[1] / 2
    # Drop columns with < 5% of the heaviest column to ignore stray AA pixels.
    thresh = max(1, int(col_counts.max() * 0.05))
    keep = col_counts >= thresh
    if not keep.any():
        return float(np.average(np.arange(len(col_counts)), weights=col_counts))
    cc = np.where(keep, col_counts, 0)
    return float(np.average(np.arange(len(cc)), weights=cc))


def process(src_path: str, skin_id: str, rows: int, cols: int, out_dir: str):
    img = Image.open(src_path).convert("RGBA")
    arr = np.array(img)
    arr = remove_white_bg(arr)

    H, W = arr.shape[:2]
    cell_h = H // rows
    cell_w = W // cols

    os.makedirs(out_dir, exist_ok=True)

    for r, facing in enumerate(FACINGS[:rows]):
        # Pass 1: per-frame bbox and center metrics within each row cell.
        frames = []   # list of (frame_rgba, cx_in_frame, foot_y_in_frame)
        max_w_left = 0
        max_w_right = 0
        max_above_foot = 0
        max_below_foot = 0

        for c in range(cols):
            cell = arr[r*cell_h:(r+1)*cell_h, c*cell_w:(c+1)*cell_w].copy()
            bb = bbox(cell[..., 3])
            if bb is None:
                # blank cell -> skip but reserve slot
                frames.append(None)
                continue
            x0, y0, x1, y1 = bb
            crop = cell[y0:y1, x0:x1]
            mask = crop[..., 3] > ALPHA_T
            cx = robust_center_x(mask)
            foot_y = crop.shape[0]  # feet = bottom of crop (we cropped tight)
            frames.append((crop, cx, foot_y))
            max_w_left  = max(max_w_left,  int(np.ceil(cx)))
            max_w_right = max(max_w_right, int(np.ceil(crop.shape[1] - cx)))
            max_above_foot = max(max_above_foot, foot_y)  # = crop height
            max_below_foot = max(max_below_foot, 0)

        # Add small padding to avoid touching cell edges.
        pad_x = 6
        pad_top = 6
        pad_bottom = 6
        out_cw = max_w_left + max_w_right + pad_x * 2
        out_ch = max_above_foot + pad_top + pad_bottom
        # Snap to even number for crisp scaling.
        if out_cw % 2: out_cw += 1
        if out_ch % 2: out_ch += 1

        sheet = np.zeros((out_ch, out_cw * cols, 4), dtype=np.uint8)

        for c, fr in enumerate(frames):
            if fr is None:
                continue
            crop, cx, foot_y = fr
            ch, cw = crop.shape[:2]
            # Horizontal: align robust center to the cell center.
            cell_cx = out_cw // 2
            dst_x = c * out_cw + cell_cx - int(round(cx))
            # Vertical: align feet to the same baseline (out_ch - pad_bottom).
            baseline = out_ch - pad_bottom
            dst_y = baseline - foot_y
            # Clip if needed
            sx0 = max(0, -dst_x); sy0 = max(0, -dst_y)
            dx0 = max(0, dst_x);  dy0 = max(0, dst_y)
            paste_w = min(cw - sx0, out_cw * cols - dx0)
            paste_h = min(ch - sy0, out_ch - dy0)
            if paste_w <= 0 or paste_h <= 0:
                continue
            region = sheet[dy0:dy0+paste_h, dx0:dx0+paste_w]
            src = crop[sy0:sy0+paste_h, sx0:sx0+paste_w]
            # alpha compose (src over empty -> just copy where src alpha > 0)
            a = src[..., 3:4] / 255.0
            region[:] = (src * a + region * (1 - a)).astype(np.uint8)
            region[..., 3] = np.maximum(region[..., 3], src[..., 3])

        out_path = os.path.join(out_dir, f"{skin_id}-{facing}.png")
        Image.fromarray(sheet, "RGBA").save(out_path, optimize=True)
        print(f"  {facing:5s} -> {out_path}  cell={out_cw}x{out_ch}  sheet={out_cw*cols}x{out_ch}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("source")
    ap.add_argument("skin_id")
    ap.add_argument("--rows", type=int, default=4)
    ap.add_argument("--cols", type=int, default=6)
    ap.add_argument("--out", default="src/assets/sprites")
    args = ap.parse_args()
    print(f"Processing {args.source} -> skin '{args.skin_id}'")
    process(args.source, args.skin_id, args.rows, args.cols, args.out)


if __name__ == "__main__":
    main()
