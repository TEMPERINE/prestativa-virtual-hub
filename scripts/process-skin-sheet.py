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
from scipy import ndimage

FACINGS = ["down", "up", "left", "right"]
ALPHA_T = 24          # treat as transparent below this
WHITE_T = 232         # near-white threshold (becomes fully transparent)
HALO_ALPHA_T = 240    # halo cleanup applies to pixels with alpha below this
EDGE_ERODE_PASSES = 2 # how many 1-px halo rings to erode around the silhouette


def remove_white_bg(arr: np.ndarray) -> np.ndarray:
    """Remove near-white background AND erode the white halo around the figure.

    Passes:
      1. Solid near-white -> fully transparent.
      2. Semi-transparent whitish pixels -> alpha killed (anti-aliased halo).
      3. Edge erosion: opaque whitish pixels that touch a transparent pixel get
         killed. Repeated EDGE_ERODE_PASSES times to remove the 1-2px white
         fringe left over from generative AI sheets.
    """
    rgb = arr[..., :3].astype(np.int16)
    a = arr[..., 3].astype(np.int16) if arr.shape[2] == 4 else np.full(arr.shape[:2], 255, np.int16)

    near_white = (rgb[..., 0] >= WHITE_T) & (rgb[..., 1] >= WHITE_T) & (rgb[..., 2] >= WHITE_T)
    a = np.where(near_white, 0, a)

    whitish_soft = (rgb.min(axis=-1) >= 205)
    a = np.where((a < HALO_ALPHA_T) & whitish_soft, 0, a)

    # Edge erosion: peel off whitish pixels right at the silhouette boundary.
    whitish_edge = rgb.min(axis=-1) >= 210
    for _ in range(EDGE_ERODE_PASSES):
        opaque = a > 0
        transparent = ~opaque
        neighbor_transparent = (
            np.pad(transparent[:-1, :], ((1, 0), (0, 0))) |
            np.pad(transparent[1:, :],  ((0, 1), (0, 0))) |
            np.pad(transparent[:, :-1], ((0, 0), (1, 0))) |
            np.pad(transparent[:, 1:],  ((0, 0), (0, 1)))
        )
        edge_halo = opaque & neighbor_transparent & whitish_edge
        a = np.where(edge_halo, 0, a)

    out = np.dstack([arr[..., :3], a.astype(np.uint8)])
    return out



def bbox(alpha: np.ndarray) -> tuple[int, int, int, int] | None:
    """Bbox of the LARGEST connected blob in the cell.

    Source grids often have neighboring characters bleeding into the cell
    (top from row above, bottom from row below, sides from adjacent columns).
    We pick the biggest connected component to isolate the main character
    and ignore stray bleed regardless of where it comes from.
    """
    mask = alpha > ALPHA_T
    if not mask.any():
        return None
    # 8-connectivity so anti-aliased thin strands don't fragment the blob.
    labels, n = ndimage.label(mask, structure=np.ones((3, 3), dtype=bool))
    if n == 0:
        return None
    sizes = ndimage.sum(mask, labels, index=np.arange(1, n + 1))
    main = int(np.argmax(sizes)) + 1
    # Merge small satellite blobs that are vertically inside the main bbox
    # (hair tips, earrings) but drop bleed from other characters.
    ys, xs = np.where(labels == main)
    y0, y1 = int(ys.min()), int(ys.max()) + 1
    x0, x1 = int(xs.min()), int(xs.max()) + 1
    # Expand to include any blob whose own bbox is fully inside main's bbox,
    # OR a small satellite directly below the main blob (feet/shoes that the
    # character art separates from the body via a contrasting color, e.g.
    # high heels under white pants — they'd be dropped otherwise).
    cell_h_local = mask.shape[0]
    for i in range(1, n + 1):
        if i == main:
            continue
        ys2, xs2 = np.where(labels == i)
        iy0, iy1 = int(ys2.min()), int(ys2.max()) + 1
        ix0, ix1 = int(xs2.min()), int(xs2.max()) + 1
        inside = (iy0 >= y0 - 2 and iy1 <= y1 + 2 and ix0 >= x0 - 4 and ix1 <= x1 + 4)
        # Below-main: small blob hanging directly under the body, horizontally
        # within (or only slightly outside) the main silhouette. Cap the gap and
        # the size so we don't pull in the next row's character.
        below_main = (
            iy0 >= y1 - 2
            and (iy0 - y1) <= max(8, int(0.06 * cell_h_local))
            and ix0 >= x0 - 6 and ix1 <= x1 + 6
            and (iy1 - iy0) <= int(0.20 * cell_h_local)
        )
        if inside or below_main:
            y0 = min(y0, iy0); y1 = max(y1, iy1)
            x0 = min(x0, ix0); x1 = max(x1, ix1)
    return x0, y0, x1, y1




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


def process(src_path: str, skin_id: str, rows: int, cols: int, out_dir: str, out_cols: int):
    img = Image.open(src_path).convert("RGBA")
    arr = np.array(img)
    arr = remove_white_bg(arr)

    H, W = arr.shape[:2]
    cell_h = H // rows
    cell_w = W // cols

    os.makedirs(out_dir, exist_ok=True)

    # ------------------------------------------------------------------
    # Pass 1 (all facings): collect per-frame crops + metrics.
    # Source AI sheets often draw the "down" pose noticeably bigger than the
    # side/up poses. We capture each facing's raw character height so we can
    # normalize them in pass 2 — otherwise the front view renders chunkier
    # than the side view in-scene.
    # ------------------------------------------------------------------
    facing_frames: dict[str, list] = {}   # facing -> list[(crop, cx, foot_y) | None]
    for r, facing in enumerate(FACINGS[:rows]):
        if facing == "right":
            continue
        frames = []
        # Bleed margin below the strict row to capture feet/shoes that the
        # source art lets dangle past the grid line (e.g. heels under pants).
        # The connected-components bbox will only keep them when they sit
        # directly under the main blob (see bbox()).
        bleed_bottom = int(cell_h * 0.18)
        for c in range(cols):
            y_end = min(H, (r + 1) * cell_h + bleed_bottom)
            cell = arr[r*cell_h:y_end, c*cell_w:(c+1)*cell_w].copy()
            bb = bbox(cell[..., 3])
            if bb is None:
                frames.append(None)
                continue
            x0, y0, x1, y1 = bb
            crop = cell[y0:y1, x0:x1]
            mask = crop[..., 3] > ALPHA_T
            cx = robust_center_x(mask)
            foot_y = crop.shape[0]
            frames.append((crop, cx, foot_y))
        facing_frames[facing] = frames

    # ------------------------------------------------------------------
    # Normalize character height across facings.
    # Use the median character height across ALL facings as the target.
    # Each facing is uniformly rescaled so its own median height matches
    # the global target — keeps the silhouette intact while making front
    # / side / back views render at the same visual size.
    # ------------------------------------------------------------------
    all_heights = [f[2] for fs in facing_frames.values() for f in fs if f is not None]
    if all_heights:
        target_h = float(np.median(all_heights))
        for facing, frames in facing_frames.items():
            heights = [f[2] for f in frames if f is not None]
            if not heights:
                continue
            cur = float(np.median(heights))
            scale = target_h / cur if cur > 0 else 1.0
            if abs(scale - 1.0) < 0.02:
                continue
            for i, fr in enumerate(frames):
                if fr is None:
                    continue
                crop, cx, foot_y = fr
                new_w = max(1, int(round(crop.shape[1] * scale)))
                new_h = max(1, int(round(crop.shape[0] * scale)))
                resized = np.array(
                    Image.fromarray(crop, "RGBA").resize((new_w, new_h), Image.LANCZOS)
                )
                frames[i] = (resized, cx * scale, foot_y * scale)

    # ------------------------------------------------------------------
    # Pass 2 (per facing): pad to out_cols, compute uniform cell, blit.
    # ------------------------------------------------------------------
    for facing, frames in facing_frames.items():
        first_real = next((f for f in frames if f is not None), None)
        while len(frames) < out_cols:
            frames.append(first_real)
        frames = frames[:out_cols]

        max_w_left = max((int(np.ceil(f[1])) for f in frames if f is not None), default=0)
        max_w_right = max(
            (int(np.ceil(f[0].shape[1] - f[1])) for f in frames if f is not None),
            default=0,
        )
        max_above_foot = max(
            (int(np.ceil(f[2])) for f in frames if f is not None), default=0
        )

        pad_x = 6
        pad_top = 6
        pad_bottom = 6
        out_cw = max_w_left + max_w_right + pad_x * 2
        out_ch = max_above_foot + pad_top + pad_bottom
        if out_cw % 2: out_cw += 1
        if out_ch % 2: out_ch += 1

        sheet = np.zeros((out_ch, out_cw * out_cols, 4), dtype=np.uint8)

        for c, fr in enumerate(frames):
            if fr is None:
                continue
            crop, cx, foot_y = fr
            ch, cw = crop.shape[:2]
            cell_cx = out_cw // 2
            dst_x = c * out_cw + cell_cx - int(round(cx))
            baseline = out_ch - pad_bottom
            dst_y = baseline - int(round(foot_y))
            sx0 = max(0, -dst_x); sy0 = max(0, -dst_y)
            dx0 = max(0, dst_x);  dy0 = max(0, dst_y)
            paste_w = min(cw - sx0, out_cw * out_cols - dx0)
            paste_h = min(ch - sy0, out_ch - dy0)
            if paste_w <= 0 or paste_h <= 0:
                continue
            region = sheet[dy0:dy0+paste_h, dx0:dx0+paste_w]
            src = crop[sy0:sy0+paste_h, sx0:sx0+paste_w]
            a = src[..., 3:4] / 255.0
            region[:] = (src * a + region * (1 - a)).astype(np.uint8)
            region[..., 3] = np.maximum(region[..., 3], src[..., 3])

        out_path = os.path.join(out_dir, f"{skin_id}-{facing}.png")
        Image.fromarray(sheet, "RGBA").save(out_path, optimize=True)
        print(f"  {facing:5s} -> {out_path}  cell={out_cw}x{out_ch}  sheet={out_cw*out_cols}x{out_ch}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("source")
    ap.add_argument("skin_id")
    ap.add_argument("--rows", type=int, default=4)
    ap.add_argument("--cols", type=int, default=6)
    ap.add_argument("--out-cols", type=int, default=6,
                    help="Number of frames per output sheet; pads with idle frame.")
    ap.add_argument("--out", default="src/assets/sprites")
    args = ap.parse_args()
    print(f"Processing {args.source} -> skin '{args.skin_id}'")
    process(args.source, args.skin_id, args.rows, args.cols, args.out, args.out_cols)




if __name__ == "__main__":
    main()
