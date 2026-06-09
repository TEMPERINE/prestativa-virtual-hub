// Browser-side port (subset) of scripts/process-skin-sheet.py.
// Pega 1 PNG arranjado em rows × cols (default 4 × 6 — down/up/left/right ×
// idle + 5 walk frames), remove o fundo branco, detecta o blob principal de
// cada célula e produz Frames editáveis. Depois, compõe os PNGs finais por
// facing com baseline e centro uniformes — formato idêntico ao do script.

export type Facing = "down" | "up" | "left" | "right";
export const FACINGS: Facing[] = ["down", "up", "left", "right"];

export type Frame = {
  facing: Facing;
  col: number;
  // Bounding box em coordenadas da folha original (px).
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  // Centro horizontal e linha do pé, em coords da própria bbox.
  cx: number;
  footY: number;
  // Se manualmente editado, não refazer auto.
  edited?: boolean;
  // Vazio (sem pixels detectados).
  empty?: boolean;
};

const ALPHA_T = 24;
const WHITE_T = 232;
const EDGE_ERODE_PASSES = 2;

/* -------------------------- background removal -------------------------- */

/** Remove fundo branco via flood-fill 8-connected a partir das bordas. */
export function removeWhiteBackground(img: ImageData): ImageData {
  const { width: W, height: H, data } = img;
  const N = W * H;
  const isWhite = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    const r = data[i * 4],
      g = data[i * 4 + 1],
      b = data[i * 4 + 2];
    if (r >= WHITE_T && g >= WHITE_T && b >= WHITE_T) isWhite[i] = 1;
  }
  // BFS a partir das bordas
  const bg = new Uint8Array(N);
  const queue: number[] = [];
  const push = (x: number, y: number) => {
    const i = y * W + x;
    if (isWhite[i] && !bg[i]) {
      bg[i] = 1;
      queue.push(i);
    }
  };
  for (let x = 0; x < W; x++) {
    push(x, 0);
    push(x, H - 1);
  }
  for (let y = 0; y < H; y++) {
    push(0, y);
    push(W - 1, y);
  }
  while (queue.length) {
    const i = queue.pop()!;
    const x = i % W;
    const y = (i - x) / W;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx,
          ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const ni = ny * W + nx;
        if (isWhite[ni] && !bg[ni]) {
          bg[ni] = 1;
          queue.push(ni);
        }
      }
    }
  }
  // Zera alpha do background
  for (let i = 0; i < N; i++) if (bg[i]) data[i * 4 + 3] = 0;

  // Erosão de halo: pixels esbranquiçados vizinhos de bg viram bg.
  for (let pass = 0; pass < EDGE_ERODE_PASSES; pass++) {
    const next: number[] = [];
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (data[i * 4 + 3] === 0) continue;
        const r = data[i * 4],
          g = data[i * 4 + 1],
          b = data[i * 4 + 2];
        if (Math.min(r, g, b) < 210) continue;
        // vizinho bg?
        let nb = false;
        if (x > 0 && bg[i - 1]) nb = true;
        else if (x < W - 1 && bg[i + 1]) nb = true;
        else if (y > 0 && bg[i - W]) nb = true;
        else if (y < H - 1 && bg[i + W]) nb = true;
        if (nb) next.push(i);
      }
    }
    for (const i of next) {
      data[i * 4 + 3] = 0;
      bg[i] = 1;
    }
  }
  return img;
}

/* ------------------------- blob bbox per cell --------------------------- */

/** Devolve bbox do MAIOR blob conectado dentro da região (alpha > ALPHA_T). */
function largestBlobBbox(
  data: Uint8ClampedArray,
  W: number,
  rx: number,
  ry: number,
  rw: number,
  rh: number,
): { x0: number; y0: number; x1: number; y1: number; cx: number } | null {
  const labels = new Int32Array(rw * rh); // 0 = unvisited/empty
  let nextLabel = 0;
  const sizes: number[] = [0];
  const bboxes: { x0: number; y0: number; x1: number; y1: number }[] = [
    { x0: 0, y0: 0, x1: 0, y1: 0 },
  ];

  for (let ly = 0; ly < rh; ly++) {
    for (let lx = 0; lx < rw; lx++) {
      const li = ly * rw + lx;
      if (labels[li]) continue;
      const gx = rx + lx,
        gy = ry + ly;
      const a = data[(gy * W + gx) * 4 + 3];
      if (a <= ALPHA_T) continue;
      nextLabel++;
      labels[li] = nextLabel;
      const stack: number[] = [li];
      let count = 0;
      let x0 = lx,
        y0 = ly,
        x1 = lx,
        y1 = ly;
      while (stack.length) {
        const j = stack.pop()!;
        count++;
        const jx = j % rw,
          jy = (j - jx) / rw;
        if (jx < x0) x0 = jx;
        if (jx > x1) x1 = jx;
        if (jy < y0) y0 = jy;
        if (jy > y1) y1 = jy;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const nx = jx + dx,
              ny = jy + dy;
            if (nx < 0 || ny < 0 || nx >= rw || ny >= rh) continue;
            const ni = ny * rw + nx;
            if (labels[ni]) continue;
            const gx2 = rx + nx,
              gy2 = ry + ny;
            const a2 = data[(gy2 * W + gx2) * 4 + 3];
            if (a2 <= ALPHA_T) continue;
            labels[ni] = nextLabel;
            stack.push(ni);
          }
        }
      }
      sizes.push(count);
      bboxes.push({ x0, y0, x1, y1 });
    }
  }
  if (nextLabel === 0) return null;
  // pega maior
  let main = 1;
  for (let i = 2; i <= nextLabel; i++) if (sizes[i] > sizes[main]) main = i;
  let { x0, y0, x1, y1 } = bboxes[main];
  // mescla satélites internos ou pequenos abaixo do main
  for (let i = 1; i <= nextLabel; i++) {
    if (i === main) continue;
    const b = bboxes[i];
    const inside = b.y0 >= y0 - 2 && b.y1 <= y1 + 2 && b.x0 >= x0 - 4 && b.x1 <= x1 + 4;
    const gap = b.y0 - y1;
    const below =
      b.y0 >= y1 - 2 &&
      gap <= Math.max(8, Math.floor(0.06 * rh)) &&
      b.x0 >= x0 - 6 &&
      b.x1 <= x1 + 6 &&
      b.y1 - b.y0 <= Math.floor(0.2 * rh);
    if (inside || below) {
      if (b.x0 < x0) x0 = b.x0;
      if (b.y0 < y0) y0 = b.y0;
      if (b.x1 > x1) x1 = b.x1;
      if (b.y1 > y1) y1 = b.y1;
    }
  }
  // centro robusto: média ponderada por contagem de pixels por coluna,
  // ignorando colunas com < 5% da mais densa.
  const colCounts = new Int32Array(x1 - x0 + 1);
  for (let ly = y0; ly <= y1; ly++) {
    for (let lx = x0; lx <= x1; lx++) {
      const gx = rx + lx,
        gy = ry + ly;
      const a = data[(gy * W + gx) * 4 + 3];
      if (a > ALPHA_T) colCounts[lx - x0]++;
    }
  }
  let maxC = 0;
  for (let i = 0; i < colCounts.length; i++) if (colCounts[i] > maxC) maxC = colCounts[i];
  const thr = Math.max(1, Math.floor(maxC * 0.05));
  let num = 0,
    den = 0;
  for (let i = 0; i < colCounts.length; i++) {
    const c = colCounts[i] >= thr ? colCounts[i] : 0;
    num += i * c;
    den += c;
  }
  const cxLocal = den > 0 ? num / den : (x1 - x0) / 2;
  return { x0: x0 + 0, y0: y0 + 0, x1: x1 + 1, y1: y1 + 1, cx: cxLocal };
}

/* ----------------------------- slicing ---------------------------------- */

export type SliceResult = {
  cleanedCanvas: HTMLCanvasElement;
  frames: Frame[];
  cellW: number;
  cellH: number;
  rows: number;
  cols: number;
  includeRight: boolean;
};

export async function sliceSheetFromFile(
  file: File,
  opts: { rows?: number; cols?: number; includeRight?: boolean } = {},
): Promise<SliceResult> {
  const rows = opts.rows ?? 4;
  const cols = opts.cols ?? 6;
  const includeRight = opts.includeRight ?? false;
  const bmp = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bmp, 0, 0);
  const img = ctx.getImageData(0, 0, bmp.width, bmp.height);
  removeWhiteBackground(img);
  ctx.putImageData(img, 0, 0);

  const W = bmp.width,
    H = bmp.height;
  const cellW = Math.floor(W / cols);
  const cellH = Math.floor(H / rows);
  const bleedB = Math.floor(cellH * 0.18);
  const bleedX = Math.floor(cellW * 0.12);

  const frames: Frame[] = [];
  for (let r = 0; r < rows; r++) {
    const facing = FACINGS[r] ?? "down";
    if (facing === "right" && !includeRight) continue;
    for (let c = 0; c < cols; c++) {
      const rx = Math.max(0, c * cellW - bleedX);
      const ry = r * cellH;
      const rw = Math.min(W - rx, cellW + bleedX * 2);
      const rh = Math.min(H - ry, cellH + bleedB);
      const bb = largestBlobBbox(img.data, W, rx, ry, rw, rh);
      if (!bb) {
        frames.push({
          facing,
          col: c,
          x0: rx,
          y0: ry,
          x1: rx + cellW,
          y1: ry + cellH,
          cx: cellW / 2,
          footY: cellH,
          empty: true,
        });
        continue;
      }
      frames.push({
        facing,
        col: c,
        x0: rx + bb.x0,
        y0: ry + bb.y0,
        x1: rx + bb.x1,
        y1: ry + bb.y1,
        cx: bb.cx,
        footY: bb.y1 - bb.y0,
      });
    }
  }
  return { cleanedCanvas: canvas, frames, cellW, cellH, rows, cols, includeRight };
}

/* ------------------------- final sheet composer ------------------------- */

/** Por facing, produz um PNG de 6 frames horizontais alinhados pela baseline. */
export function composeFacingSheet(
  source: HTMLCanvasElement,
  frames: Frame[],
  facing: Facing,
  outCols = 6,
): { dataUrl: string; w: number; h: number; blob: Promise<Blob> } {
  const fs = frames.filter((f) => f.facing === facing);
  if (fs.length === 0) throw new Error(`Sem frames para ${facing}`);

  // padding & dims uniformes pela maior crop
  const padX = 6,
    padTop = 6,
    padBottom = 6;
  let maxLeft = 0,
    maxRight = 0,
    maxAbove = 0;
  for (const f of fs) {
    if (f.empty) continue;
    const w = f.x1 - f.x0;
    const h = f.y1 - f.y0;
    maxLeft = Math.max(maxLeft, Math.ceil(f.cx));
    maxRight = Math.max(maxRight, Math.ceil(w - f.cx));
    maxAbove = Math.max(maxAbove, Math.ceil(f.footY));
    void h;
  }
  let cellW = maxLeft + maxRight + padX * 2;
  let cellH = maxAbove + padTop + padBottom;
  if (cellW % 2) cellW++;
  if (cellH % 2) cellH++;

  // pad to outCols (repeat first non-empty)
  while (fs.length < outCols) fs.push({ ...fs[0] });
  fs.length = outCols;

  const out = document.createElement("canvas");
  out.width = cellW * outCols;
  out.height = cellH;
  const ctx = out.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;

  for (let i = 0; i < outCols; i++) {
    const f = fs[i];
    if (f.empty) continue;
    const w = f.x1 - f.x0;
    const h = f.y1 - f.y0;
    const cellCx = Math.floor(cellW / 2);
    const dstX = i * cellW + cellCx - Math.round(f.cx);
    const baseline = cellH - padBottom;
    const dstY = baseline - Math.round(f.footY);
    ctx.drawImage(source, f.x0, f.y0, w, h, dstX, dstY, w, h);
  }
  const dataUrl = out.toDataURL("image/png");
  const blob = new Promise<Blob>((resolve, reject) =>
    out.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob falhou"))), "image/png"),
  );
  return { dataUrl, w: cellW, h: cellH, blob };
}
