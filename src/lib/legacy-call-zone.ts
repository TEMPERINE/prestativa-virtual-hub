/**
 * Regra LEGADA (v1) de zona para chamada, extraída sem alteração de
 * OfficeScene.tsx para poder ser comparada nos testes de paridade.
 * O path v2 NÃO usa esta função: usa zoneIdAtPoint (canonical-zones).
 */
import { ZONES, zoneAtWithOverrides as zoneAt, type Point, type ZoneId } from "@/lib/office-map";
import { customZonesFromOverrides, zoneRectFromOverrides } from "@/lib/map-overrides";

function pointInsideRect(p: Point, rect: { x1: number; y1: number; x2: number; y2: number }) {
  return p.x >= rect.x1 && p.x <= rect.x2 && p.y >= rect.y1 && p.y <= rect.y2;
}

export function legacyCallZoneAt(p: Point): ZoneId {
  const direct = zoneAt(p);
  if (direct.id !== "lobby") return direct.id;
  const commonZones = [
    ...ZONES.filter((z) => z.id !== "lobby").map((z) => z.id),
    ...customZonesFromOverrides().map((z) => z.id),
  ];
  for (const id of commonZones) {
    const rect = zoneRectFromOverrides(id as ZoneId);
    if (rect && pointInsideRect(p, rect)) return id as ZoneId;
  }
  return "lobby";
}
