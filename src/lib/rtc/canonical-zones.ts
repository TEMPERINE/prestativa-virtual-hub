// Resolução PURA de zona a partir do mapa canônico (map_overrides normalizado):
//   - com overrides: a zona só existe se estiver pintada no grid;
//   - sem overrides (sem linha / reset): zonas embutidas (ZONES, exceto lobby);
//   - toda zona existente (common OU workspace) → rtcMode ZONE_ROOM;
//     só circulação (sem zona) → PROXIMITY_LOBBY.
// Kind (domínio): zoneKinds > customZone.kind > DEFAULT_ZONE_KINDS > "common".
import { ZONES, zoneAt as builtinZoneAt, type Point } from "@/lib/office-map";
import {
  DEFAULT_ZONE_KINDS,
  cellIndex,
  pointToCell,
  type MapOverrides,
  type ZoneKind,
} from "@/lib/map-overrides";

export type ZoneResolution =
  | { ok: true; zoneId: string }
  | { ok: false; reason: "ZONE_NOT_FOUND" | "ZONE_NOT_PRIVATE" };

function kindOf(map: MapOverrides | null, id: string): ZoneKind {
  const o = map?.zoneKinds?.[id];
  if (o) return o;
  const custom = map?.customZones?.find((c) => c.id === id);
  if (custom?.kind) return custom.kind;
  return DEFAULT_ZONE_KINDS[id] ?? "common";
}

/**
 * Modo RTC derivado do domínio:
 *  - PROXIMITY_LOBBY: circulação (ponto sem zona pintada) → Room LOBBY + proximidade;
 *  - ZONE_ROOM: qualquer zona existente (common OU workspace) → Room própria, autoSubscribe.
 * zoneKind (semântica do editor) é independente do rtcMode.
 */
export type RtcMode = "PROXIMITY_LOBBY" | "ZONE_ROOM";

/** Classificação canônica de uma zona (mesma para cliente V2 e Token V2). */
export interface ZoneClassification {
  zoneId: string;
  /** Zona existe neste mapa (pintada, ou embutida quando não há overrides). */
  exists: boolean;
  /** Tipo de domínio do editor ("common" | "workspace"); não decide RTC. */
  kind: ZoneKind;
  supportsVideo: boolean;
  rtcMode: RtcMode;
  /** true = rtcMode ZONE_ROOM (Room LiveKit própria). */
  isPrivateRoom: boolean;
}

export function classifyZone(map: MapOverrides | null, zoneId: string): ZoneClassification {
  if (!zoneId || zoneId === "lobby") {
    return {
      zoneId: "lobby",
      exists: true,
      kind: "common",
      supportsVideo: false,
      rtcMode: "PROXIMITY_LOBBY",
      isPrivateRoom: false,
    };
  }
  const builtin = ZONES.find((z) => z.id === zoneId && z.id !== "lobby");
  let exists: boolean;
  if (map) {
    const painted = map.zones.some((z) => z === zoneId);
    const known = !!builtin || !!map.customZones?.some((c) => c.id === zoneId);
    exists = painted && known;
  } else {
    exists = !!builtin;
  }
  const kind = kindOf(map, zoneId);
  const supportsVideo = builtin?.supportsVideo ?? false;
  const rtcMode: RtcMode = exists ? "ZONE_ROOM" : "PROXIMITY_LOBBY";
  return {
    zoneId,
    exists,
    kind,
    supportsVideo,
    rtcMode,
    isPrivateRoom: rtcMode === "ZONE_ROOM",
  };
}

export function resolveMeetingZone(map: MapOverrides | null, zoneId: string): ZoneResolution {
  if (!zoneId || zoneId === "lobby") return { ok: false, reason: "ZONE_NOT_FOUND" };
  const c = classifyZone(map, zoneId);
  if (!c.exists) return { ok: false, reason: "ZONE_NOT_FOUND" };
  return c.isPrivateRoom ? { ok: true, zoneId } : { ok: false, reason: "ZONE_NOT_PRIVATE" };
}

// ─── Regra PURA ponto → zona (RTC v2, Etapa 12) ─────────────────────────────
// Espelha callZoneAt do cliente legado, mas recebendo o mapa canônico
// explicitamente (sem localStorage/estado global):
//   1) com mapa: célula pintada → zona (se for embutida ou custom conhecida);
//      senão, envelope (bounding box das células pintadas) de uma zona conhecida;
//   2) sem mapa: retângulos das zonas embutidas.
// Retorna "lobby" quando nenhuma zona se aplica.

function knownZone(map: MapOverrides, id: string): boolean {
  return (
    ZONES.some((z) => z.id === id && z.id !== "lobby") ||
    !!map.customZones?.some((c) => c.id === id)
  );
}

export function paintedRect(
  map: MapOverrides,
  id: string,
): { x1: number; y1: number; x2: number; y2: number } | null {
  let minC = Infinity,
    minR = Infinity,
    maxC = -Infinity,
    maxR = -Infinity;
  for (let r = 0; r < map.rows; r++) {
    for (let c = 0; c < map.cols; c++) {
      if (map.zones[cellIndex(c, r, map.cols)] === id) {
        if (c < minC) minC = c;
        if (c > maxC) maxC = c;
        if (r < minR) minR = r;
        if (r > maxR) maxR = r;
      }
    }
  }
  if (!Number.isFinite(minC)) return null;
  return {
    x1: minC / map.cols,
    y1: minR / map.rows,
    x2: (maxC + 1) / map.cols,
    y2: (maxR + 1) / map.rows,
  };
}

export function zoneIdAtPoint(map: MapOverrides | null, p: Point): string {
  if (!map) return builtinZoneAt(p).id;
  const { col, row } = pointToCell(p, map.cols, map.rows);
  const direct = map.zones[cellIndex(col, row, map.cols)];
  if (direct && direct !== "lobby" && knownZone(map, direct)) return direct;
  const ids = [
    ...ZONES.filter((z) => z.id !== "lobby").map((z) => z.id as string),
    ...(map.customZones ?? []).map((c) => c.id),
  ];
  for (const id of ids) {
    const rect = paintedRect(map, id);
    if (rect && p.x >= rect.x1 && p.x <= rect.x2 && p.y >= rect.y1 && p.y <= rect.y2) return id;
  }
  return "lobby";
}

/**
 * Zona de reunião privada no ponto, pela MESMA regra que o Token V2 valida.
 * null = lobby / zona que não é sala de reunião.
 */
export function meetingZoneAtPoint(map: MapOverrides | null, p: Point): string | null {
  const id = zoneIdAtPoint(map, p);
  if (id === "lobby") return null;
  const r = resolveMeetingZone(map, id);
  return r.ok ? r.zoneId : null;
}

/** Ponto → classificação completa, pela regra canônica. */
export function classifyPoint(map: MapOverrides | null, p: Point): ZoneClassification {
  return classifyZone(map, zoneIdAtPoint(map, p));
}
