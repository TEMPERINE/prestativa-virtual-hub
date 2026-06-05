// Store leve do estado dinâmico de props (frames sincronizados + actions
// vindos do MapOverrides). Permite que qualquer parte do app — em especial o
// loop de movimento do OfficeScene — consulte rapidamente se uma sala está
// "trancada" por algum prop (ex.: porta fechada).
//
// Fluxo:
//  - PropsLayer chama `publishProps(...)` quando recebe override novo
//    e `publishFrames(...)` quando o realtime de prop_states muda.
//  - OfficeScene usa `isMoveGated(fromZone, toZone)` no tryMove.

import type { PropInstance } from "./map-overrides";

export type PropAction =
  // Bloqueia entrada/saída de uma zona enquanto o frame atual do prop
  // for igual a `blockedFrame`.
  | { type: "gate-zone"; zoneId: string; blockedFrame: number };

let currentProps: PropInstance[] = [];
let currentFrames: Record<string, number> = {};
const listeners = new Set<() => void>();

function notify() {
  for (const l of listeners) {
    try { l(); } catch { /* noop */ }
  }
}

export function publishProps(props: PropInstance[]) {
  currentProps = props ?? [];
  notify();
}

export function publishFrames(frames: Record<string, number>) {
  currentFrames = frames ?? {};
  notify();
}

export function subscribeGates(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Conjunto de zoneIds atualmente trancados por algum prop. */
export function gatedZones(): Set<string> {
  const set = new Set<string>();
  for (const p of currentProps) {
    if (!p.actions || p.actions.length === 0) continue;
    if (p.interactive === false) continue;
    const frame = currentFrames[p.id] ?? p.frame ?? 0;
    for (const a of p.actions) {
      if (a.type === "gate-zone" && a.blockedFrame === frame) {
        set.add(a.zoneId);
      }
    }
  }
  return set;
}

export function isZoneGated(zoneId: string | null | undefined): boolean {
  if (!zoneId) return false;
  return gatedZones().has(zoneId);
}

/** Bloqueio total (ambos os sentidos): movimento entre zonas é negado se a
 *  zona de origem OU a de destino estiver trancada. */
export function isMoveGated(
  fromZone: string | null | undefined,
  toZone: string | null | undefined
): boolean {
  if (fromZone === toZone) return false;
  const gated = gatedZones();
  return gated.has(fromZone ?? "") || gated.has(toZone ?? "");
}
