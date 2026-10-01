// Textos e regras puras do fluxo "Enviar reunião" (testáveis sem tela).
export const UNDO_WINDOW_MS = 5000;

export function canSubmitSelection(selected: ReadonlySet<string> | string[]): boolean {
  return (Array.isArray(selected) ? selected.length : selected.size) > 0;
}

export function selectionLabel(n: number): string {
  return n === 1 ? "1 colaborador selecionado" : `${n} colaboradores selecionados`;
}

export function confirmQuestion(names: string[]): string {
  return names.length === 1
    ? `Deseja enviar esta reunião para ${names[0]}?`
    : `Deseja enviar esta reunião para estes ${names.length} colaboradores?`;
}

/** Quantidade mostrada = todos os selecionados (quem já tinha acesso continua tendo). */
export function sentToast(n: number): string {
  return n === 1 ? "Reunião enviada para 1 colaborador." : `Reunião enviada para ${n} colaboradores.`;
}

/** Quem já possui a reunião: participou (meeting_participants) ou já recebeu. */
export type AccessKind = "participant" | "shared";

export function buildAccessMap(rows: Array<{ user_id: string; kind: string }>): Map<string, AccessKind> {
  const m = new Map<string, AccessKind>();
  for (const r of rows) {
    if (r.kind === "participant") m.set(r.user_id, "participant"); // participação prevalece
    else if (r.kind === "shared" && !m.has(r.user_id)) m.set(r.user_id, "shared");
  }
  return m;
}

export function accessBadge(kind: AccessKind): string {
  return kind === "participant" ? "Já possui • Participou" : "Já possui • Recebida";
}

/** Só conta/envia quem ainda não possui a reunião. */
export function validSelection(selected: ReadonlySet<string>, access: ReadonlyMap<string, AccessKind>): Set<string> {
  return new Set([...selected].filter((id) => !access.has(id)));
}
