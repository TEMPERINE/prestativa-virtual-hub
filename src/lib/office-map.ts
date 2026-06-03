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
    rect: { x1: 0.68, y1: 0.04, x2: 0.94, y2: 0.46 },
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

// Walkable boundary inside the building (avatar cannot leave the office).
const FLOOR = { x1: 0.105, y1: 0.04, x2: 0.955, y2: 0.96 };

// Furniture / wall colliders the avatar must walk around.
export const COLLIDERS: Array<{ x1: number; y1: number; x2: number; y2: number }> = [
  // Descompressão sofas + coffee table
  { x1: 0.14, y1: 0.10, x2: 0.29, y2: 0.27 },

  // Diretoria — two desks
  { x1: 0.34, y1: 0.14, x2: 0.47, y2: 0.30 },
  { x1: 0.50, y1: 0.14, x2: 0.63, y2: 0.30 },

  // Sala de Reunião — table + chairs (whole interior blocked, entry from left around y=0.36)
  { x1: 0.70, y1: 0.08, x2: 0.92, y2: 0.34 },
  { x1: 0.70, y1: 0.40, x2: 0.92, y2: 0.46 },
  // Reunião wall (separates from main floor) with a door gap around y=0.34-0.40
  { x1: 0.66, y1: 0.04, x2: 0.685, y2: 0.34 },
  { x1: 0.66, y1: 0.40, x2: 0.685, y2: 0.50 },

  // Supervisora desk
  { x1: 0.19, y1: 0.50, x2: 0.31, y2: 0.62 },

  // Operação — 2 rows of desks (corridor of 0.04 between rows)
  { x1: 0.35, y1: 0.55, x2: 0.64, y2: 0.68 },
  { x1: 0.35, y1: 0.76, x2: 0.64, y2: 0.90 },

  // Feedback room (interior + walls; door gap on left around y=0.68-0.74)
  { x1: 0.80, y1: 0.60, x2: 0.92, y2: 0.84 },
  { x1: 0.78, y1: 0.58, x2: 0.80, y2: 0.68 },
  { x1: 0.78, y1: 0.74, x2: 0.80, y2: 0.86 },

  // Kitchen / watercooler counter on far left
  { x1: 0.105, y1: 0.34, x2: 0.16, y2: 0.94 },
];

export function collides(p: Point, radius = 0.014): boolean {
  // Outside the building floor
  if (p.x - radius < FLOOR.x1 || p.x + radius > FLOOR.x2) return true;
  if (p.y - radius < FLOOR.y1 || p.y + radius > FLOOR.y2) return true;
  // Hit any furniture / wall
  for (const c of COLLIDERS) {
    if (p.x + radius > c.x1 && p.x - radius < c.x2 && p.y + radius > c.y1 && p.y - radius < c.y2) {
      return true;
    }
  }
  return false;
}

// Spawn at the lobby — central corridor between the diretoria/operação,
// guaranteed to be outside any collider.
export const SPAWN: Point = { x: 0.50, y: 0.42 };

// Isometric rotation applied to input vector so "up arrow" feels like walking
// INTO the office (slightly up-right). The office image is mostly top-down
// with a small forward tilt, so a gentle rotation reads as natural.
export const ISO_ROTATION_RAD = (-12 * Math.PI) / 180;

export function rotateIso(dx: number, dy: number): { dx: number; dy: number } {
  const c = Math.cos(ISO_ROTATION_RAD);
  const s = Math.sin(ISO_ROTATION_RAD);
  return { dx: dx * c - dy * s, dy: dx * s + dy * c };
}
