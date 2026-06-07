// Identifica o workspace atualmente carregado no app. Setado pela rota
// /_authenticated/workspaces/$workspaceId antes do OfficeScene montar.
// Helpers de baixo nível (map-overrides, custom-props, PropsLayer) leem daqui
// pra escopar queries/upserts sem precisar receber prop de toda cadeia.

let _currentWorkspaceId: string | null = null;
const listeners = new Set<(id: string | null) => void>();

export function setCurrentWorkspaceId(id: string | null) {
  if (_currentWorkspaceId === id) return;
  _currentWorkspaceId = id;
  listeners.forEach((fn) => fn(id));
}

export function getCurrentWorkspaceId(): string | null {
  return _currentWorkspaceId;
}

export function requireCurrentWorkspaceId(): string {
  if (!_currentWorkspaceId) throw new Error("Nenhum workspace ativo.");
  return _currentWorkspaceId;
}

export function subscribeCurrentWorkspaceId(fn: (id: string | null) => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
