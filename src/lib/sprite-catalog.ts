// Catálogo de personagens disponíveis. Skins antigas podem ter 4 sheets;
// skins novas usam down/up/left e renderizam right espelhado do left.

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

import redheadDown from "@/assets/sprites/redhead-down.png";
import redheadUp from "@/assets/sprites/redhead-up.png";
import redheadLeft from "@/assets/sprites/redhead-left.png";
import redheadRight from "@/assets/sprites/redhead-right.png";

import afroDown from "@/assets/sprites/afro-down.png";
import afroUp from "@/assets/sprites/afro-up.png";
import afroLeft from "@/assets/sprites/afro-left.png";
import afroRight from "@/assets/sprites/afro-right.png";

import japaDown from "@/assets/sprites/japa-down.png";
import japaUp from "@/assets/sprites/japa-up.png";
import japaLeft from "@/assets/sprites/japa-left.png";

export type Facing = "up" | "down" | "left" | "right";

export type SpriteSheets = Record<Facing, string>;
export type SpriteDims = Record<Facing, { w: number; h: number }>;

export type SpriteDef = {
  id: string;
  label: string;
  gender: "m" | "f" | "n";
  sheets: SpriteSheets;
  dims: SpriteDims;
  /** Legado: quando true, a folha "left" é renderizada espelhando a "right". */
  mirrorLeftFromRight?: boolean;
  /** Quando true, a folha "right" é renderizada espelhando a "left" (padrão para skins novas). */
  mirrorRightFromLeft?: boolean;
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
      left: { w: 255, h: 206 },
      right: { w: 255, h: 206 },
    },
    mirrorLeftFromRight: true,
  },
  {
    id: "curly",
    label: "Morena Cacheada",
    gender: "f",
    sheets: { up: curlyUp, down: curlyDown, left: curlyLeft, right: curlyRight },
    dims: {
      down: { w: 255, h: 226 },
      up: { w: 255, h: 251 },
      left: { w: 255, h: 205 },
      right: { w: 255, h: 205 },
    },
    mirrorLeftFromRight: true,
  },
  {
    id: "redhead",
    label: "Ruiva",
    gender: "f",
    sheets: { up: redheadUp, down: redheadDown, left: redheadLeft, right: redheadRight },
    dims: {
      down: { w: 255, h: 228 },
      up: { w: 255, h: 222 },
      left: { w: 255, h: 213 },
      right: { w: 255, h: 213 },
    },
    mirrorLeftFromRight: true,
  },
  {
    id: "afro",
    label: "Afro",
    gender: "f",
    sheets: { up: afroUp, down: afroDown, left: afroLeft, right: afroRight },
    dims: {
      down: { w: 255, h: 243 },
      up: { w: 255, h: 242 },
      left: { w: 255, h: 227 },
      right: { w: 255, h: 227 },
    },
    mirrorLeftFromRight: true,
  },
  {
    id: "japa",
    label: "Japa",
    gender: "f",
    sheets: { up: japaUp, down: japaDown, left: japaLeft, right: japaLeft },
    dims: {
      down: { w: 128, h: 248 },
      up: { w: 126, h: 250 },
      left: { w: 126, h: 236 },
      right: { w: 126, h: 236 },
    },
    mirrorRightFromLeft: true,
  },
];

export const SPRITE_FRAMES = 6;
export const DEFAULT_SPRITE_ID = "marcio";

export function getSprite(id: string | null | undefined): SpriteDef {
  return SPRITES.find((s) => s.id === id) ?? SPRITES[0];
}
