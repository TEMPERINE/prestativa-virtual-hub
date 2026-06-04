// Catálogo de personagens disponíveis. Cada sprite tem 4 sheets direcionais
// (down/up/left/right) com 6 frames horizontais (0 = idle, 1..5 = caminhada).

import avatarDown from "@/assets/avatar-down.png";
import avatarUp from "@/assets/avatar-up.png";
import avatarLeft from "@/assets/avatar-left.png";
import avatarRight from "@/assets/avatar-right.png";

import blondeDown from "@/assets/sprites/blonde-down.png";
import blondeUp from "@/assets/sprites/blonde-up.png";
import blondeLeft from "@/assets/sprites/blonde-left.png";
import blondeRight from "@/assets/sprites/blonde-right.png";

import curlyDown from "@/assets/sprites/curly-down.png";
import curlyUp from "@/assets/sprites/curly-up.png";
import curlyLeft from "@/assets/sprites/curly-left.png";
import curlyRight from "@/assets/sprites/curly-right.png";

export type Facing = "up" | "down" | "left" | "right";

export type SpriteSheets = Record<Facing, string>;
export type SpriteDims = Record<Facing, { w: number; h: number }>;

export type SpriteDef = {
  id: string;
  label: string;
  gender: "m" | "f" | "n";
  sheets: SpriteSheets;
  dims: SpriteDims;
};

export const SPRITES: SpriteDef[] = [
  {
    id: "marcio",
    label: "Márcio",
    gender: "m",
    sheets: { up: avatarUp, down: avatarDown, left: avatarLeft, right: avatarRight },
    dims: {
      down: { w: 151, h: 245 },
      up: { w: 136, h: 235 },
      left: { w: 142, h: 235 },
      right: { w: 139, h: 235 },
    },
  },
  {
    id: "blonde",
    label: "Loira",
    gender: "f",
    sheets: { up: blondeUp, down: blondeDown, left: blondeLeft, right: blondeRight },
    dims: {
      down: { w: 255, h: 232 },
      up: { w: 255, h: 246 },
      left: { w: 255, h: 249 },
      right: { w: 255, h: 206 },
    },
  },
  {
    id: "curly",
    label: "Morena Cacheada",
    gender: "f",
    sheets: { up: curlyUp, down: curlyDown, left: curlyLeft, right: curlyRight },
    dims: {
      down: { w: 255, h: 226 },
      up: { w: 255, h: 251 },
      left: { w: 255, h: 249 },
      right: { w: 255, h: 205 },
    },
  },
];

export const SPRITE_FRAMES = 6;
export const DEFAULT_SPRITE_ID = "marcio";

export function getSprite(id: string | null | undefined): SpriteDef {
  return SPRITES.find((s) => s.id === id) ?? SPRITES[0];
}
