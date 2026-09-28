// Resolução PURA de zona de reunião a partir do mapa canônico (map_overrides
// normalizado). Replica exatamente a regra do cliente:
//   - com overrides: a zona só existe se estiver pintada no grid;
//   - sem overrides (sem linha / reset): zonas embutidas (ZONES, exceto lobby);
//   - aceita reunião se `supportsVideo` OU kind === "common".
// Kind: zoneKinds > customZone.kind > DEFAULT_ZONE_KINDS > "common".
import { ZONES } from "@/lib/office-map";
import { DEFAULT_ZONE_KINDS, type MapOverrides, type ZoneKind } from "@/lib/map-overrides";

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

export function resolveMeetingZone(map: MapOverrides | null, zoneId: string): ZoneResolution {
  if (!zoneId || zoneId === "lobby") return { ok: false, reason: "ZONE_NOT_FOUND" };
  const builtin = ZONES.find((z) => z.id === zoneId && z.id !== "lobby");
  let exists: boolean;
  if (map) {
    const painted = map.zones.some((z) => z === zoneId);
    const known = !!builtin || !!map.customZones?.some((c) => c.id === zoneId);
    exists = painted && known;
  } else {
    exists = !!builtin;
  }
  if (!exists) return { ok: false, reason: "ZONE_NOT_FOUND" };
  const meeting = (builtin?.supportsVideo ?? false) || kindOf(map, zoneId) === "common";
  return meeting ? { ok: true, zoneId } : { ok: false, reason: "ZONE_NOT_PRIVATE" };
}
