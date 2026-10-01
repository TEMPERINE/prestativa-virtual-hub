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
