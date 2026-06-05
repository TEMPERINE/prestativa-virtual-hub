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
};

export const PROP_CATALOG: PropDef[] = [
  {
    id: "door",
    label: "Porta",
    frames: [doorClosed.url, doorOpen.url],
    defaultW: 0.08,
    aspectRatio: 245 / 230, // aproximado das artes enviadas
    interactive: true,
    interactKey: "x",
  },
];

export function getPropDef(id: string): PropDef | undefined {
  return PROP_CATALOG.find((p) => p.id === id);
}
