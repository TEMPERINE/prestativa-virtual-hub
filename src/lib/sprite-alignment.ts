// Per-frame horizontal centering for sprite sheets.
//
// Many of our sprite sheets were drawn with the character at a slightly
// different X position inside each frame's cell. Since the cells are
// equal-width, stepping `background-position-x` across them shows the
// character "samba-ing" horizontally between frames.
//
// Fix: load each sheet once into an offscreen canvas, scan opaque pixels
// per frame cell to find the character's horizontal centroid, then expose
// a normalized offset (range roughly -0.5..0.5, in units of cell-width)
// that the renderer adds to its background-position calculation so every
// frame is re-centered on the cell.

const SPRITE_FRAMES = 6;
const ALPHA_THRESHOLD = 32;

// sheetSrc → array of length SPRITE_FRAMES with dx in cell-width units
// (positive = character was drawn right of center; we'll shift LEFT to compensate).
const cache = new Map<string, number[]>();
const inflight = new Map<string, Promise<number[]>>();
const listeners = new Set<() => void>();

export function getFrameOffsets(sheetSrc: string): number[] | null {
  return cache.get(sheetSrc) ?? null;
}

export function subscribeFrameOffsets(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

export function ensureFrameOffsets(sheetSrc: string): Promise<number[]> {
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
      const zeros = new Array(SPRITE_FRAMES).fill(0);
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

function computeOffsets(img: HTMLImageElement): number[] {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const cellW = Math.floor(w / SPRITE_FRAMES);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return new Array(SPRITE_FRAMES).fill(0);
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, w, h).data;

  const out: number[] = [];
  for (let f = 0; f < SPRITE_FRAMES; f++) {
    const x0 = f * cellW;
    const x1 = x0 + cellW;
    let sumX = 0;
    let count = 0;
    // Only use the upper portion of the cell (head/torso) — feet animate
    // and would skew the horizontal center.
    const yEnd = Math.floor(h * 0.7);
    for (let y = 0; y < yEnd; y++) {
      const rowOff = y * w * 4;
      for (let x = x0; x < x1; x++) {
        const a = data[rowOff + x * 4 + 3];
        if (a > ALPHA_THRESHOLD) {
          sumX += x - x0;
          count++;
        }
      }
    }
    if (count === 0) { out.push(0); continue; }
    const centroid = sumX / count; // pixels from cell left
    const cellCenter = cellW / 2;
    const dxPx = centroid - cellCenter; // +: char drawn right of center
    out.push(dxPx / cellW); // normalize to cell-width units
  }

  // Use a SINGLE uniform offset for every frame (mean of all frame centroids).
  // Per-frame compensation amplified small head/arm motion into visible
  // horizontal "samba". A uniform offset centers the character in the cell
  // without introducing any per-frame horizontal jitter.
  const valid = out.filter((v) => Number.isFinite(v));
  const mean = valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : 0;
  return out.map(() => mean);
}
