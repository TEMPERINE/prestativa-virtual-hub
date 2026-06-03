// Tile-based overrides painted in the Map Editor.
// Persisted to localStorage so the OfficeScene picks them up automatically.

import type { ZoneId } from "./office-map";

export const GRID_COLS = 64;
export const GRID_ROWS = 40;
const STORAGE_KEY = "office-map-overrides:v1";

export type MapOverrides = {
  cols: number;
  rows: number;
  // length = cols*rows. 1 = blocked, 0 = walkable.
  blocked: number[];
  // length = cols*rows. zone id or null.
  zones: (ZoneId | null)[];
};

function emptyOverrides(): MapOverrides {
  const size = GRID_COLS * GRID_ROWS;
  return {
    cols: GRID_COLS,
    rows: GRID_ROWS,
    blocked: new Array(size).fill(0),
    zones: new Array(size).fill(null),
  };
}

let cache: MapOverrides | null | undefined;

export function loadOverrides(): MapOverrides | null {
  if (cache !== undefined) return cache;
  if (typeof window === "undefined") return (cache = null);
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return (cache = null);
    const parsed = JSON.parse(raw) as MapOverrides;
    if (!parsed.cols || !parsed.rows || !Array.isArray(parsed.blocked)) {
      return (cache = null);
    }
    cache = parsed;
    return cache;
  } catch {
    return (cache = null);
  }
}

export function saveOverrides(o: MapOverrides) {
  cache = o;
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(o));
  window.dispatchEvent(new CustomEvent("map-overrides-changed"));
}

export function clearOverrides() {
  cache = null;
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(STORAGE_KEY);
  window.dispatchEvent(new CustomEvent("map-overrides-changed"));
}

export function newOverrides(): MapOverrides {
  return emptyOverrides();
}

export function cellIndex(col: number, row: number, cols = GRID_COLS) {
  return row * cols + col;
}

export function pointToCell(p: { x: number; y: number }, cols = GRID_COLS, rows = GRID_ROWS) {
  const col = Math.max(0, Math.min(cols - 1, Math.floor(p.x * cols)));
  const row = Math.max(0, Math.min(rows - 1, Math.floor(p.y * rows)));
  return { col, row };
}

// True if the given normalized point falls on a blocked tile.
export function isBlockedByOverrides(p: { x: number; y: number }, radius = 0): boolean {
  const o = loadOverrides();
  if (!o) return false;
  // Sample center + 4 shoulders so the avatar's body can't clip into tiles.
  const samples = radius
    ? [
        p,
        { x: p.x - radius, y: p.y },
        { x: p.x + radius, y: p.y },
        { x: p.x, y: p.y - radius },
        { x: p.x, y: p.y + radius },
      ]
    : [p];
  for (const s of samples) {
    const { col, row } = pointToCell(s, o.cols, o.rows);
    if (o.blocked[cellIndex(col, row, o.cols)] === 1) return true;
  }
  return false;
}

export function zoneFromOverrides(p: { x: number; y: number }): ZoneId | null {
  const o = loadOverrides();
  if (!o) return null;
  const { col, row } = pointToCell(p, o.cols, o.rows);
  return o.zones[cellIndex(col, row, o.cols)] ?? null;
}

export function hasZoneOverrides(): boolean {
  const o = loadOverrides();
  if (!o) return false;
  return o.zones.some((z) => z !== null);
}

// Bounding box (normalized 0..1) of all painted tiles for a given zone id.
// Returns null when nothing is painted for that zone.
export function zoneRectFromOverrides(
  id: ZoneId
): { x1: number; y1: number; x2: number; y2: number } | null {
  const o = loadOverrides();
  if (!o) return null;
  let minC = Infinity, minR = Infinity, maxC = -Infinity, maxR = -Infinity;
  for (let r = 0; r < o.rows; r++) {
    for (let c = 0; c < o.cols; c++) {
      if (o.zones[cellIndex(c, r, o.cols)] === id) {
        if (c < minC) minC = c;
        if (c > maxC) maxC = c;
        if (r < minR) minR = r;
        if (r > maxR) maxR = r;
      }
    }
  }
  if (!isFinite(minC)) return null;
  return {
    x1: minC / o.cols,
    y1: minR / o.rows,
    x2: (maxC + 1) / o.cols,
    y2: (maxR + 1) / o.rows,
  };
}

