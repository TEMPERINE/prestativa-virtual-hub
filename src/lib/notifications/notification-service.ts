/**
 * OfficeNotificationService — contrato de notificação do sistema.
 * Web: WebNotificationAdapter (Notification API).
 * Futuro Desktop/EXE: DesktopNotificationAdapter (notificação nativa, foco,
 * badge, flash da taskbar) — sem mudar Follow nem o onboarding.
 */
export type OfficePermission = "granted" | "denied" | "default" | "unsupported";

export type OfficeNotification = {
  title: string;
  body: string;
  tag?: string;
  /** Deve só focar o app e mostrar o pedido — nunca executar ações. */
  onClick?: () => void;
};

export interface OfficeNotificationService {
  getPermission(): OfficePermission;
  /** Só pode ser chamado após clique explícito do usuário. */
  requestPermission(): Promise<OfficePermission>;
  isOptedIn(): boolean;
  setOptedIn(on: boolean): void;
  isAppHidden(): boolean;
  notify(n: OfficeNotification): void;
  focusApp(): void;
}

let current: OfficeNotificationService | null = null;
export function setNotificationService(s: OfficeNotificationService) {
  current = s;
}
export function getNotificationService(): OfficeNotificationService | null {
  return current;
}

// ===== Etapa de onboarding de notificações (por usuário, neste dispositivo) =====
const SETUP_KEY = (uid: string) => `officeNotifSetupDone:${uid}`;

export function isNotificationSetupDone(uid: string): boolean {
  try { return localStorage.getItem(SETUP_KEY(uid)) === "1"; } catch { return true; }
}
export function markNotificationSetupDone(uid: string) {
  try { localStorage.setItem(SETUP_KEY(uid), "1"); } catch { /* ignore */ }
}
