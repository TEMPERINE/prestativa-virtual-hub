// Per-frame head alignment for sprite sheets.
//
// Goal: when overlaying frames of a walk cycle on top of each other, the
// HEAD must sit on the same X and Y. Otherwise the character "samba-s"
// (horizontal wobble) or "bobs" too much (vertical wobble) between frames.
//
// Approach:
//   1. Load each sheet once into an offscreen canvas.
//   2. For each frame cell, find the topmost opaque pixel row (top of head)
//      and define a small "head band" below it (~22% of cell height).
//   3. Within that band, compute a robust horizontal center for the head,
//      trimming edge outliers so one stray pixel cannot move the frame.
//   4. Frame X offsets target the CENTER OF THE CELL, which is also the
//      renderer's shadow center. Frame Y offsets still use the average
//      head-top Y to avoid vertical bobbing without detaching feet from shadow.

const SPRITE_FRAMES = 6;
const ALPHA_THRESHOLD = 32;

export type FrameOffset = { dx: number; dy: number };

const cache = new Map<string, FrameOffset[]>();
const inflight = new Map<string, Promise<FrameOffset[]>>();
const listeners = new Set<() => void>();

export function getFrameOffsets(sheetSrc: string): FrameOffset[] | null {
  return cache.get(sheetSrc) ?? null;
}

export function subscribeFrameOffsets(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

export function ensureFrameOffsets(sheetSrc: string): Promise<FrameOffset[]> {
  const hit = cache.get(sheetSrc);
  if (hit) return Promise.resolve(hit);
  const pending = inflight.get(sheetSrc);
  if (pending) return pending;

  const p = (async () => {
    try {
      const img = await loadImage(sheetSrc);
      const offsets = computeOffsets(img);
      cache.set(sheetSrc, offsets);
      listeners.forEach((cb) => { try { cb(); } catch { /* noop */ } });
      return offsets;
    } catch {
      const zeros: FrameOffset[] = new Array(SPRITE_FRAMES).fill(0).map(() => ({ dx: 0, dy: 0 }));
      cache.set(sheetSrc, zeros);
      return zeros;
    } finally {
      inflight.delete(sheetSrc);
    }
  })();
  inflight.set(sheetSrc, p);
  return p;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function computeOffsets(img: HTMLImageElement): FrameOffset[] {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const cellW = Math.floor(w / SPRITE_FRAMES);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const zero: FrameOffset[] = new Array(SPRITE_FRAMES).fill(0).map(() => ({ dx: 0, dy: 0 }));
  if (!ctx) return zero;
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, w, h).data;

  // Per-frame head metrics.
  const headX: number[] = new Array(SPRITE_FRAMES).fill(NaN);
  const headTopY: number[] = new Array(SPRITE_FRAMES).fill(NaN);
  // Min opaque pixels in a row to consider it "real content" (skip stray AA
  // pixels and hair wisps that move between frames).
  const MIN_ROW_PIXELS = Math.max(4, Math.floor(cellW * 0.05));
  // Head band height: ~22% of cell height starting from the topmost solid row.
  const HEAD_BAND = Math.max(6, Math.floor(h * 0.22));

  for (let f = 0; f < SPRITE_FRAMES; f++) {
    const x0 = f * cellW;
    const x1 = x0 + cellW;

    // 1. Find topmost SOLID row (>= MIN_ROW_PIXELS opaque pixels).
    let topY = -1;
    for (let y = 0; y < h; y++) {
      const rowOff = y * w * 4;
      let rowCount = 0;
      for (let x = x0; x < x1; x++) {
        if (data[rowOff + x * 4 + 3] > ALPHA_THRESHOLD) rowCount++;
      }
      if (rowCount >= MIN_ROW_PIXELS) { topY = y; break; }
    }
    if (topY < 0) continue;
    headTopY[f] = topY;

    // 2. Robust horizontal center of the head band. We use percentiles instead
    //    of raw min/max because exported sheets can contain isolated edge
    //    pixels in a single frame (Japa had this), which would otherwise make
    //    that frame jump sideways.
    const yEnd = Math.min(h, topY + HEAD_BAND);
    const xs: number[] = [];
    for (let y = topY; y < yEnd; y++) {
      const rowOff = y * w * 4;
      for (let x = x0; x < x1; x++) {
        if (data[rowOff + x * 4 + 3] > ALPHA_THRESHOLD) {
          xs.push(x - x0);
        }
      }
    }
    if (xs.length > 0) headX[f] = robustCenter(xs);
  }

  // X reference is the cell center so every frame's head lands exactly on the
  // renderer's shadow center. Y reference remains the mean top to avoid bobbing.
  const validX = headX.filter((v) => Number.isFinite(v));
  const validY = headTopY.filter((v) => Number.isFinite(v));
  if (validX.length === 0) return zero;
  const refX = cellW / 2;
  const refY = validY.length ? validY.reduce((a, b) => a + b, 0) / validY.length : 0;

  const out: FrameOffset[] = [];
  for (let f = 0; f < SPRITE_FRAMES; f++) {
    const fx = Number.isFinite(headX[f]) ? headX[f] : refX;
    const fy = Number.isFinite(headTopY[f]) ? headTopY[f] : refY;
    // dx > 0 means this frame's head is RIGHT of reference → renderer must
    // move the crop window RIGHT (add dx to background-position).
    // dy > 0 means this frame's head is BELOW reference → renderer must
    // shift the image UP (subtract dy from background-position).
    out.push({
      dx: (fx - refX) / cellW,
      dy: (fy - refY) / h,
    });
  }
  return out;
}

function robustCenter(values: number[]): number {
  const sorted = values.slice().sort((a, b) => a - b);
  const low = percentile(sorted, 0.15);
  const high = percentile(sorted, 0.85);
  return (low + high) / 2;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 1) return sorted[0];
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)));
  return sorted[idx];
}
