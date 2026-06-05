// Catálogo de elementos (mobiliários / props) que podem ser colocados sobre o mapa.
// Cada elemento tem 1+ frames. Se for interativo, o usuário próximo pode
// alternar o frame ativo via tecla (ex.: porta aberta/fechada com "X").

import doorClosed from "@/assets/props/door-closed.png.asset.json";
import doorOpen from "@/assets/props/door-open.png.asset.json";

export type PropDef = {
  id: string;
  label: string;
  frames: string[];        // URLs (1+); frame 0 = padrão
  defaultW: number;        // largura padrão em fração do mapa (0..1)
  aspectRatio: number;     // largura / altura para preservar proporção
  interactive: boolean;    // suporta tecla de interação
  interactKey?: string;    // tecla minúscula, ex. "x"
  /** Y (fração do bounding box, 0=topo, 1=base) usado como ponto de
   *  comparação de profundidade. Padrão = 1 (base). Em assets com muito
   *  alfa transparente abaixo, usar o meio do conteúdo visível dá o
   *  resultado correto — o avatar passa "na frente" até esse ponto. */
  depthRefY?: number;
  /** Aparece na frente dos avatares quando há uma sala focada. */
  foregroundWhenFocused?: boolean;
};

export const PROP_CATALOG: PropDef[] = [
  {
    id: "door",
    label: "Porta",
    frames: [doorClosed.url, doorOpen.url],
    defaultW: 0.08,
    aspectRatio: 233 / 293, // medido a partir do PNG real
    interactive: true,
    interactKey: "x",
    // meio do conteúdo visível: o alfa do PNG vai de y=56 a y=284 em 293px
    depthRefY: 0.58,
    foregroundWhenFocused: true,
  },
];

export function getPropDef(id: string): PropDef | undefined {
  return PROP_CATALOG.find((p) => p.id === id);
}
