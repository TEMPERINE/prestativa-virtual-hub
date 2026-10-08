// TEMPORÁRIO Fase 3 — assets runtime pré-reduzidos (só /sprite-compare).
import type { Facing } from "@/lib/sprite-catalog";
import mDown1x from "@/assets/sprites/fase3/marcio-down-1x.png";
import mDown2x from "@/assets/sprites/fase3/marcio-down-2x.png";
import mUp1x from "@/assets/sprites/fase3/marcio-up-1x.png";
import mUp2x from "@/assets/sprites/fase3/marcio-up-2x.png";
import mLeft1x from "@/assets/sprites/fase3/marcio-left-1x.png";
import mLeft2x from "@/assets/sprites/fase3/marcio-left-2x.png";
import mRight1x from "@/assets/sprites/fase3/marcio-right-1x.png";
import mRight2x from "@/assets/sprites/fase3/marcio-right-2x.png";
import kDown1x from "@/assets/sprites/fase3/karen-down-1x.png";
import kDown2x from "@/assets/sprites/fase3/karen-down-2x.png";
import kUp1x from "@/assets/sprites/fase3/karen-up-1x.png";
import kUp2x from "@/assets/sprites/fase3/karen-up-2x.png";
import kLeft1x from "@/assets/sprites/fase3/karen-left-1x.png";
import kLeft2x from "@/assets/sprites/fase3/karen-left-2x.png";
import kRight1x from "@/assets/sprites/fase3/karen-right-1x.png";
import kRight2x from "@/assets/sprites/fase3/karen-right-2x.png";
import bDown1x from "@/assets/sprites/fase3/bia-down-1x.png";
import bDown2x from "@/assets/sprites/fase3/bia-down-2x.png";
import bUp1x from "@/assets/sprites/fase3/bia-up-1x.png";
import bUp2x from "@/assets/sprites/fase3/bia-up-2x.png";
import bLeft1x from "@/assets/sprites/fase3/bia-left-1x.png";
import bLeft2x from "@/assets/sprites/fase3/bia-left-2x.png";
type S = { src: string; w: number; h: number };
export const RUNTIME: Record<string, Record<'1x'|'2x', Partial<Record<Facing, S>>>> = {
  marcio: {
    '1x': { down: { src: mDown1x, w: 49, h: 80 }, up: { src: mUp1x, w: 44, h: 76 }, left: { src: mLeft1x, w: 46, h: 76 }, right: { src: mRight1x, w: 45, h: 76 } },
    '2x': { down: { src: mDown2x, w: 98, h: 159 }, up: { src: mUp2x, w: 88, h: 153 }, left: { src: mLeft2x, w: 92, h: 153 }, right: { src: mRight2x, w: 90, h: 153 } },
  },
  karen: {
    '1x': { down: { src: kDown1x, w: 42, h: 79 }, up: { src: kUp1x, w: 42, h: 80 }, left: { src: kLeft1x, w: 47, h: 79 }, right: { src: kRight1x, w: 45, h: 79 } },
    '2x': { down: { src: kDown2x, w: 84, h: 158 }, up: { src: kUp2x, w: 84, h: 159 }, left: { src: kLeft2x, w: 94, h: 158 }, right: { src: kRight2x, w: 90, h: 158 } },
  },
  bia: {
    '1x': { down: { src: bDown1x, w: 43, h: 79 }, up: { src: bUp1x, w: 42, h: 80 }, left: { src: bLeft1x, w: 44, h: 80 } },
    '2x': { down: { src: bDown2x, w: 86, h: 158 }, up: { src: bUp2x, w: 83, h: 159 }, left: { src: bLeft2x, w: 87, h: 159 } },
  },
};
