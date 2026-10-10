import type { OfficeNotification, OfficeNotificationService } from "./notification-service";
import { getNotificationsOptIn } from "./web-notification-adapter";

export interface DesktopNotificationBridge {
  getState(): { background: boolean; supported: boolean };
  show(payload: { title: string; body: string; tag: string; silent?: boolean }): Promise<boolean>;
  focus(): Promise<boolean>;
  clear(): Promise<void>;
  onClick(callback: (tag: string) => void): () => void;
}

declare global {
  interface Window {
    prestativaDesktop?: { isDesktop: boolean; notifications?: DesktopNotificationBridge };
  }
}

export function createDesktopNotificationAdapter(bridge: DesktopNotificationBridge): OfficeNotificationService {
  // Callback routing only. JoinInviteCenter remains the sole owner of invites.
  const callbacks = new Map<string, () => void>();
  let unsubscribe: (() => void) | undefined;
  const report = (error: unknown) => console.error("[office-notify] desktop IPC failed", String(error));
  const setOptedIn = (on: boolean) => {
    try {
      if (on) localStorage.setItem("officeNotificationsOptIn", "1");
      else localStorage.removeItem("officeNotificationsOptIn");
    } catch { /* Browser/device storage unavailable. */ }
  };
  const permission = () => bridge.getState().supported ? "granted" as const : "unsupported" as const;
  return {
    kind: "desktop",
    getPermission: permission,
    requestPermission: async () => { setOptedIn(true); return permission(); },
    isOptedIn: getNotificationsOptIn,
    setOptedIn,
    isAppHidden: () => bridge.getState().background || document.visibilityState === "hidden" || !document.hasFocus(),
    focusApp: () => { void bridge.focus().catch(report); },
    notify(n: OfficeNotification) {
      if (!getNotificationsOptIn()) return;
      if (!n.tag) return;
      unsubscribe ??= bridge.onClick(tag => {
        const callback = callbacks.get(tag);
        callbacks.delete(tag);
        callback?.();
      });
      if (n.onClick) callbacks.set(n.tag, n.onClick);
      if (callbacks.size > 100) callbacks.delete(callbacks.keys().next().value!);
      const callback = n.onClick;
      void bridge.show({ title: n.title, body: n.body, tag: n.tag, silent: n.silent }).then(shown => {
        if (!shown && callbacks.get(n.tag!) === callback) callbacks.delete(n.tag!);
      }).catch(error => {
        if (callbacks.get(n.tag!) === callback) callbacks.delete(n.tag!);
        report(error);
      });
    },
    dispose() {
      unsubscribe?.(); unsubscribe = undefined;
      callbacks.clear();
      void bridge.clear().catch(report);
    },
  };
}
