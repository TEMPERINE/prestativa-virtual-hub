// Office map definition. All coordinates are normalized 0..1 relative to the
// background image (src/assets/office-map.jpg, 1536x1024 effective area).
// This makes the layout resolution-independent and easy to tweak.

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
  // axis-aligned bounding rectangle in normalized coords (x1,y1)-(x2,y2)
  rect: { x1: number; y1: number; x2: number; y2: number };
  audioRoom: string; // LiveKit room name (used in fase 3)
  supportsVideo: boolean;
  accent: string; // tailwind color token (CSS var)
};

export const ZONES: Zone[] = [
  {
    id: "descompressao",
    label: "Área de Descompressão",
    subtitle: "Respire. Desacelere. Recomece.",
    rect: { x1: 0.105, y1: 0.04, x2: 0.345, y2: 0.31 },
    audioRoom: "zone:descompressao",
    supportsVideo: false,
    accent: "var(--zone-descompressao)",
  },
  {
    id: "diretoria",
    label: "Diretoria",
    subtitle: "Márcio · Dani",
    rect: { x1: 0.345, y1: 0.04, x2: 0.66, y2: 0.32 },
    audioRoom: "zone:diretoria",
    supportsVideo: false,
    accent: "var(--zone-diretoria)",
  },
  {
    id: "reuniao",
    label: "Sala de Reunião",
    subtitle: "Até 16 pessoas",
    rect: { x1: 0.66, y1: 0.04, x2: 0.93, y2: 0.50 },
    audioRoom: "zone:reuniao",
    supportsVideo: true,
    accent: "var(--zone-reuniao)",
  },
  {
    id: "supervisao",
    label: "Supervisão",
    subtitle: "Dani Oliveira",
    rect: { x1: 0.16, y1: 0.46, x2: 0.32, y2: 0.65 },
    audioRoom: "zone:supervisao",
    supportsVideo: false,
    accent: "var(--zone-supervisao)",
  },
  {
    id: "operacao",
    label: "Operação / Atendimento",
    subtitle: "10 secretárias",
    rect: { x1: 0.32, y1: 0.50, x2: 0.66, y2: 0.95 },
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

// Collision: axis-aligned rectangles the avatar cannot enter. Coordinates
// hand-tuned against the generated office-map.jpg. Walls + furniture only —
// open floor (corridors) is walkable.
export const COLLIDERS: Array<{ x1: number; y1: number; x2: number; y2: number }> = [
  // Outer walls (top/bottom/left strips, leaving a small inner playable area)
  { x1: 0, y1: 0, x2: 1, y2: 0.035 }, // top wall
  { x1: 0, y1: 0.965, x2: 1, y2: 1 }, // bottom wall
  { x1: 0, y1: 0, x2: 0.095, y2: 1 }, // left wall (kitchen/grass)
  { x1: 0.955, y1: 0, x2: 1, y2: 1 }, // right wall (road)

  // Decompressão furniture (sofas, table)
  { x1: 0.13, y1: 0.10, x2: 0.30, y2: 0.27 },

  // Diretoria desks (two big desks under the logo wall)
  { x1: 0.37, y1: 0.16, x2: 0.49, y2: 0.30 },
  { x1: 0.52, y1: 0.16, x2: 0.64, y2: 0.30 },

  // Reuniao table + chairs (entire interior of the room is blocked except entry)
  { x1: 0.69, y1: 0.10, x2: 0.91, y2: 0.46 },

  // Wall separating reuniao from main floor (with door gap around y=0.46)
  { x1: 0.66, y1: 0.04, x2: 0.68, y2: 0.44 },

  // Supervisora desk
  { x1: 0.18, y1: 0.52, x2: 0.31, y2: 0.62 },

  // Operação — 2 rows of 5 desks
  { x1: 0.34, y1: 0.55, x2: 0.65, y2: 0.69 }, // row 1
  { x1: 0.34, y1: 0.77, x2: 0.65, y2: 0.91 }, // row 2

  // Feedback room interior
  { x1: 0.80, y1: 0.62, x2: 0.92, y2: 0.84 },
  // Wall separating feedback from floor (gap on left for door)
  { x1: 0.78, y1: 0.55, x2: 0.80, y2: 0.62 },
  { x1: 0.78, y1: 0.72, x2: 0.80, y2: 0.86 },

  // Kitchen counter on far left
  { x1: 0.105, y1: 0.35, x2: 0.17, y2: 0.95 },
];

export function collides(p: Point, radius = 0.018): boolean {
  for (const c of COLLIDERS) {
    if (
      p.x + radius > c.x1 &&
      p.x - radius < c.x2 &&
      p.y + radius > c.y1 &&
      p.y - radius < c.y2
    ) {
      return true;
    }
  }
  return false;
}

export const SPAWN: Point = { x: 0.50, y: 0.92 }; // front door / entrance
