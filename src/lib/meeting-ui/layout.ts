/**
 * Meeting UI V2 — lógica puramente visual (sem RTC).
 * Flag VITE_MEETING_UI_V2 é independente de VITE_RTC_ENGINE.
 */
export function readMeetingUiV2Flag(raw: unknown): boolean {
  return String(raw ?? "").trim().toLowerCase() === "true";
}
export const MEETING_UI_V2 = readMeetingUiV2Flag(import.meta.env.VITE_MEETING_UI_V2);

export type MeetingDisplayMode = "office" | "meeting" | "presentation";

export function resolveMeetingDisplayMode(input: {
  inPrivateRoom: boolean;
  hasScreenShare: boolean;
}): MeetingDisplayMode {
  if (input.hasScreenShare) return "presentation";
  if (input.inPrivateRoom) return "meeting";
  return "office";
}

/** Tamanho mínimo legível de um tile 16:9. */
export const MIN_TILE_W = 280;
export const MIN_TILE_H = 158;
export const MAX_PER_PAGE = 9;

export type GridPlan = { cols: number; rows: number; perPage: number; pages: number };

function colsFor(n: number): number {
  if (n <= 1) return 1;
  if (n <= 4) return 2;
  return 3;
}

/**
 * Regra: até 9 por página (1→1x1, 2→2x1, 3-4→2x2, 5-6→3x2, 7-9→3x3),
 * limitado ainda pelo que cabe na área com tiles ≥ MIN_TILE_W×MIN_TILE_H.
 * Acima disso → paginação.
 */
export function planGrid(count: number, width: number, height: number, gap = 12): GridPlan {
  const n = Math.max(0, count);
  const fitCols = Math.max(1, Math.floor((width + gap) / (MIN_TILE_W + gap)));
  const fitRows = Math.max(1, Math.floor((height + gap) / (MIN_TILE_H + gap)));
  const capacity = Math.max(1, Math.min(MAX_PER_PAGE, fitCols * fitRows));
  const perPage = Math.max(1, Math.min(capacity, n || 1));
  let cols = Math.min(colsFor(perPage), fitCols);
  let rows = Math.ceil(perPage / cols);
  if (rows > fitRows) {
    rows = fitRows;
    cols = Math.min(fitCols, Math.ceil(perPage / rows));
  }
  return { cols, rows, perPage, pages: Math.max(1, Math.ceil(n / perPage)) };
}

export function pageSlice<T>(items: T[], page: number, perPage: number): T[] {
  const p = Math.max(0, page);
  return items.slice(p * perPage, p * perPage + perPage);
}

export function clampPage(page: number, pages: number): number {
  return Math.min(Math.max(0, page), Math.max(0, pages - 1));
}
