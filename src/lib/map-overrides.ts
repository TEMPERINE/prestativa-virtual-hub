// Tile-based overrides painted in the Map Editor.
// Persisted to localStorage so the OfficeScene picks them up automatically.

import type { ZoneId } from "./office-map";

export const GRID_COLS = 128;
export const GRID_ROWS = 80;
const STORAGE_KEY = "office-map-overrides:v1";

export type ZoneKind = "workspace" | "common";
export type CustomZone = { id: string; label: string; color: string; kind?: ZoneKind };

export type SpawnPoint = { x: number; y: number };

export type MapOverrides = {
  cols: number;
  rows: number;
  blocked: number[];
  zones: (ZoneId | null)[];
  customZones?: CustomZone[];
  // Per-zone kind override (workspace=claimable, common=shared).
  zoneKinds?: Record<string, ZoneKind>;
  // Per-zone spawn / teleport landing point (normalized 0..1).
  spawnPoints?: Record<string, SpawnPoint>;
};

function emptyOverrides(): MapOverrides {
  const size = GRID_COLS * GRID_ROWS;
  return {
    cols: GRID_COLS,
    rows: GRID_ROWS,
    blocked: new Array(size).fill(0),
    zones: new Array(size).fill(null),
    customZones: [],
    zoneKinds: {},
    spawnPoints: {},
  };
}

// Defaults for built-in zones — workstations are claimable, social rooms are common.
const DEFAULT_ZONE_KINDS: Record<string, ZoneKind> = {
  "atendente-1": "workspace", "atendente-2": "workspace", "atendente-3": "workspace",
  "atendente-4": "workspace", "atendente-5": "workspace", "atendente-6": "workspace",
  "atendente-7": "workspace", "atendente-8": "workspace", "atendente-9": "workspace",
  "atendente-10": "workspace",
  "supervisao": "workspace",
  "diretoria": "workspace",
  "reuniao": "common",
  "feedback": "common",
  "descompressao": "common",
  "lobby": "common",
};

export function getZoneKind(id: string): ZoneKind {
  const o = loadOverrides();
  const override = o?.zoneKinds?.[id];
  if (override) return override;
  const custom = o?.customZones?.find((c) => c.id === id);
  if (custom?.kind) return custom.kind;
  return DEFAULT_ZONE_KINDS[id] ?? "common";
}

export function setZoneKind(id: string, kind: ZoneKind) {
  const o = loadOverrides() ?? emptyOverrides();
  const next: MapOverrides = { ...o, zoneKinds: { ...(o.zoneKinds ?? {}), [id]: kind } };
  saveOverrides(next);
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

// ---- Cloud sync (Lovable Cloud) ----------------------------------------
// The map editor used to live only in localStorage, so clearing the browser
// cache or switching device wiped the layout. We mirror the doc into the
// `map_overrides` table (id = 'global') so it's shared and persistent.

const CLOUD_ID = "global";

export async function pullOverridesFromCloud(): Promise<MapOverrides | null> {
  if (typeof window === "undefined") return null;
  try {
    const { supabase } = await import("@/integrations/supabase/client");
    const { data, error } = await supabase
      .from("map_overrides")
      .select("data")
      .eq("id", CLOUD_ID)
      .maybeSingle();
    if (error || !data) return loadOverrides();
    const parsed = (data.data as unknown) as MapOverrides;
    if (!parsed?.cols || !parsed?.rows || !Array.isArray(parsed.blocked)) {
      return loadOverrides();
    }
    cache = parsed;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
    } catch {}
    window.dispatchEvent(new CustomEvent("map-overrides-changed"));
    return parsed;
  } catch {
    return loadOverrides();
  }
}

export async function pushOverridesToCloud(
  o: MapOverrides
): Promise<{ ok: boolean; error?: string }> {
  try {
    const { supabase } = await import("@/integrations/supabase/client");
    const { data: userData } = await supabase.auth.getUser();
    const { error } = await supabase.from("map_overrides").upsert(
      {
        id: CLOUD_ID,
        data: JSON.parse(JSON.stringify(o)),
        updated_by: userData.user?.id ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" }
    );
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function clearOverridesInCloud(): Promise<void> {
  try {
    const { supabase } = await import("@/integrations/supabase/client");
    await supabase.from("map_overrides").delete().eq("id", CLOUD_ID);
  } catch {}
}

export function subscribeOverridesFromCloud(
  onChange: (o: MapOverrides | null) => void
) {
  let cleanup = () => {};
  (async () => {
    const { supabase } = await import("@/integrations/supabase/client");
    const channel = supabase
      .channel("map_overrides:global")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "map_overrides",
          filter: `id=eq.${CLOUD_ID}`,
        },
        (payload) => {
          const next =
            (payload.new as { data?: MapOverrides } | null)?.data ?? null;
          if (next) {
            cache = next;
            if (typeof window !== "undefined") {
              try {
                window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
              } catch {}
              window.dispatchEvent(new CustomEvent("map-overrides-changed"));
            }
            onChange(next);
          } else {
            cache = null;
            if (typeof window !== "undefined") {
              window.localStorage.removeItem(STORAGE_KEY);
              window.dispatchEvent(new CustomEvent("map-overrides-changed"));
            }
            onChange(null);
          }
        }
      )
      .subscribe();
    cleanup = () => {
      supabase.removeChannel(channel);
    };
  })();
  return () => cleanup();
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

export function customZonesFromOverrides(): CustomZone[] {
  const o = loadOverrides();
  return o?.customZones ?? [];
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


// Spawn point overrides — exact teleport landing per zone.
export function spawnPointForZone(id: string): SpawnPoint | null {
  const o = loadOverrides();
  const p = o?.spawnPoints?.[id];
  if (p && typeof p.x === "number" && typeof p.y === "number") return p;
  return null;
}

export function setSpawnPoint(id: string, point: SpawnPoint) {
  const o = loadOverrides() ?? emptyOverrides();
  const next: MapOverrides = {
    ...o,
    spawnPoints: { ...(o.spawnPoints ?? {}), [id]: point },
  };
  saveOverrides(next);
}

export function clearSpawnPoint(id: string) {
  const o = loadOverrides();
  if (!o?.spawnPoints) return;
  const next = { ...o.spawnPoints };
  delete next[id];
  saveOverrides({ ...o, spawnPoints: next });
}
