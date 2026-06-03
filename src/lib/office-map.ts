// Office map definition. Coordinates are normalized 0..1 relative to the
// office building image (src/assets/office-map.jpg).

export type Point = { x: number; y: number };

export type ZoneId =
  | "operacao"
  | "supervisao"
  | "diretoria"
  | "reuniao"
  | "feedback"
  | "descompressao"
  | "lobby";

export type Zone = {
  id: ZoneId;
  label: string;
  subtitle?: string;
  rect: { x1: number; y1: number; x2: number; y2: number };
  audioRoom: string;
  supportsVideo: boolean;
  accent: string;
};

// Zones tuned to the actual office image (only INSIDE the building).
export const ZONES: Zone[] = [
  {
    id: "descompressao",
    label: "Área de Descompressão",
    subtitle: "Respire. Desacelere. Recomece.",
    rect: { x1: 0.115, y1: 0.06, x2: 0.30, y2: 0.30 },
    audioRoom: "zone:descompressao",
    supportsVideo: false,
    accent: "var(--zone-descompressao)",
  },
  {
    id: "diretoria",
    label: "Diretoria",
    subtitle: "Márcio · Dani",
    rect: { x1: 0.31, y1: 0.10, x2: 0.66, y2: 0.32 },
    audioRoom: "zone:diretoria",
    supportsVideo: false,
    accent: "var(--zone-diretoria)",
  },
  {
    id: "reuniao",
    label: "Sala de Reunião",
    subtitle: "Até 16 pessoas",
    rect: { x1: 0.685, y1: 0.05, x2: 0.915, y2: 0.44 },
    audioRoom: "zone:reuniao",
    supportsVideo: true,
    accent: "var(--zone-reuniao)",
  },
  {
    id: "supervisao",
    label: "Supervisão",
    subtitle: "Dani Oliveira",
    rect: { x1: 0.17, y1: 0.46, x2: 0.32, y2: 0.66 },
    audioRoom: "zone:supervisao",
    supportsVideo: false,
    accent: "var(--zone-supervisao)",
  },
  {
    id: "operacao",
    label: "Operação / Atendimento",
    subtitle: "10 secretárias",
    rect: { x1: 0.33, y1: 0.50, x2: 0.66, y2: 0.93 },
    audioRoom: "zone:operacao",
    supportsVideo: false,
    accent: "var(--zone-operacao)",
  },
  {
    id: "feedback",
    label: "Sala de Feedback",
    subtitle: "Conversas 1:1",
    rect: { x1: 0.78, y1: 0.58, x2: 0.94, y2: 0.86 },
    audioRoom: "zone:feedback",
    supportsVideo: true,
    accent: "var(--zone-feedback)",
  },
  {
    id: "lobby",
    label: "Corredor",
    rect: { x1: 0, y1: 0, x2: 1, y2: 1 },
    audioRoom: "zone:lobby",
    supportsVideo: false,
    accent: "var(--muted)",
  },
];

export function zoneAt(p: Point): Zone {
  for (const z of ZONES) {
    if (z.id === "lobby") continue;
    if (p.x >= z.rect.x1 && p.x <= z.rect.x2 && p.y >= z.rect.y1 && p.y <= z.rect.y2) {
      return z;
    }
  }
  return ZONES[ZONES.length - 1];
}

// Furniture / wall colliders the avatar must walk around.
export const COLLIDERS: Array<{ x1: number; y1: number; x2: number; y2: number }> = [
  // Descompressão sofas + coffee table
  { x1: 0.14, y1: 0.10, x2: 0.29, y2: 0.27 },
  // Diretoria — two desks
  { x1: 0.34, y1: 0.14, x2: 0.47, y2: 0.30 },
  { x1: 0.50, y1: 0.14, x2: 0.63, y2: 0.30 },
  // Sala de Reunião — interior (table + chairs); door gap on left around y=0.34-0.40
  { x1: 0.70, y1: 0.08, x2: 0.91, y2: 0.34 },
  { x1: 0.70, y1: 0.40, x2: 0.91, y2: 0.44 },
  // Reunião wall (separates from main floor) with door gap
  { x1: 0.66, y1: 0.05, x2: 0.685, y2: 0.34 },
  { x1: 0.66, y1: 0.40, x2: 0.685, y2: 0.50 },
  // Supervisora desk
  { x1: 0.19, y1: 0.50, x2: 0.31, y2: 0.62 },
  // Operação — 2 rows of desks
  { x1: 0.35, y1: 0.55, x2: 0.64, y2: 0.68 },
  { x1: 0.35, y1: 0.76, x2: 0.64, y2: 0.90 },
  // Feedback room (interior + walls; door gap on left)
  { x1: 0.80, y1: 0.60, x2: 0.92, y2: 0.84 },
  { x1: 0.78, y1: 0.58, x2: 0.80, y2: 0.68 },
  { x1: 0.78, y1: 0.74, x2: 0.80, y2: 0.86 },
  // Kitchen / watercooler counter on far left
  { x1: 0.105, y1: 0.34, x2: 0.16, y2: 0.94 },
];


// Walkable world bounds — a slightly trapezoidal polygon so the floor
// edges follow the office's isometric perspective instead of a flat
// rectangle. Points in clockwise order: TL, TR, BR, BL.
export const FLOOR_POLY: Point[] = [
  { x: 0.118, y: 0.05 },  // top-left
  { x: 0.948, y: 0.05 },  // top-right
  { x: 0.955, y: 0.955 }, // bottom-right (slight outward flare)
  { x: 0.105, y: 0.955 }, // bottom-left
];

function pointInPolygon(p: Point, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    const intersect =
      yi > p.y !== yj > p.y &&
      p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function collides(p: Point, radius = 0.014): boolean {
  // Outside the building floor polygon
  if (!pointInPolygon(p, FLOOR_POLY)) return true;
  // Check the four "shoulders" of the body around the point so the avatar
  // doesn't clip into the iso edges.
  if (
    !pointInPolygon({ x: p.x - radius, y: p.y }, FLOOR_POLY) ||
    !pointInPolygon({ x: p.x + radius, y: p.y }, FLOOR_POLY) ||
    !pointInPolygon({ x: p.x, y: p.y - radius }, FLOOR_POLY) ||
    !pointInPolygon({ x: p.x, y: p.y + radius }, FLOOR_POLY)
  ) {
    return true;
  }
  // Hit any furniture / wall
  for (const c of COLLIDERS) {
    if (p.x + radius > c.x1 && p.x - radius < c.x2 && p.y + radius > c.y1 && p.y - radius < c.y2) {
      return true;
    }
  }
  return false;
}

// Spawn at the lobby — central corridor between diretoria and operação.
export const SPAWN: Point = { x: 0.50, y: 0.42 };
