// Catálogo de elementos (mobiliários / props) que podem ser colocados sobre o mapa.
// Cada elemento tem 1+ frames. Se for interativo, o usuário próximo pode
// alternar o frame ativo via tecla (ex.: porta aberta/fechada com "X").

import doorClosed from "@/assets/props/door-closed.png.asset.json";
import doorOpen from "@/assets/props/door-open.png.asset.json";
// Sino Meta — frames gerados por scripts/build-bell-meta.py: suporte 100%
// fixo, sino rotacionado em torno do pivô do gancho (0°, -18°, -9°, +9°, +18°).
// Importados direto (bundle) para nunca servir versão desatualizada.
import bellMeta1 from "@/assets/props/bell-meta-1.png";
import bellMeta2 from "@/assets/props/bell-meta-2.png";
import bellMeta3 from "@/assets/props/bell-meta-3.png";
import bellMeta4 from "@/assets/props/bell-meta-4.png";
import bellMeta5 from "@/assets/props/bell-meta-5.png";
import bellSound from "@/assets/sounds/bell.mp3.asset.json";

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
  /** Elementos carregados pelo usuário (galeria personalizada). */
  custom?: boolean;
  /** Animação one-shot disparada pela interação. Em vez de ciclar frames,
   *  reproduz a sequência localmente e retorna ao frame de repouso. */
  animation?: {
    sequence: number[]; // índices dentro de frames[] a exibir em ordem
    frameMs: number;    // duração de cada frame
    restFrame?: number; // frame de repouso (default 0)
  };
  /** URL de som tocado a cada interação. Múltiplos cliques se sobrepõem
   *  (cada clique cria uma nova instância de Audio sem cortar a anterior). */
  soundUrl?: string;
};

export const BUILTIN_PROPS: PropDef[] = [
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
  {
    id: "bell-meta",
    label: "Sino Meta",
    // índice → ângulo do sino: 0 = repouso (0°); 1 = -18°; 2 = -9°; 3 = +9°; 4 = +18°
    frames: [bellMeta1, bellMeta2, bellMeta3, bellMeta4, bellMeta5],
    defaultW: 0.05,
    aspectRatio: 240 / 250, // canvas idêntico em todos os frames (pivô fixo)
    interactive: true,
    interactKey: "x",
    depthRefY: 0.5,
    foregroundWhenFocused: true,
    animation: {
      // pêndulo: 2 balanços completos + 1 amortecido, terminando no repouso
      sequence: [
        4, 3, 0, 2, 1, 2, 0, 3,
        4, 3, 0, 2, 1, 2, 0, 3,
        3, 0, 2, 0,
      ],
      frameMs: 75,
      restFrame: 0,
    },
    soundUrl: bellSound.url,
  },
];

// Registry mutável: builtins + custom props carregados da nuvem.
export const PROP_CATALOG: PropDef[] = [...BUILTIN_PROPS];

type Listener = () => void;
const listeners = new Set<Listener>();

export function subscribePropCatalog(cb: Listener): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function notify() {
  for (const cb of listeners) cb();
}

export function setCustomProps(defs: PropDef[]) {
  // remove os custom anteriores e adiciona os novos preservando os builtins.
  PROP_CATALOG.length = 0;
  PROP_CATALOG.push(...BUILTIN_PROPS, ...defs.map((d) => ({ ...d, custom: true })));
  notify();
}

export function getPropDef(id: string): PropDef | undefined {
  return PROP_CATALOG.find((p) => p.id === id);
}
