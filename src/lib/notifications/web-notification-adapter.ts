import type { OfficeNotificationService, OfficePermission } from "./notification-service";

const OPT_IN_KEY = "officeNotificationsOptIn";

export function getNotificationsOptIn(): boolean {
  try { return localStorage.getItem(OPT_IN_KEY) === "1"; } catch { return false; }
}

function setOptIn(on: boolean) {
  try {
    if (on) localStorage.setItem(OPT_IN_KEY, "1");
    else localStorage.removeItem(OPT_IN_KEY);
  } catch { /* ignore */ }
}

function permission(): OfficePermission {
  if (typeof Notification === "undefined") return "unsupported";
  return Notification.permission;
}

/** Só chamado por ação consciente do usuário. Nunca re-pede se já decidido. */
export async function enableOfficeNotifications(): Promise<OfficePermission> {
  setOptIn(true);
  const p = permission();
  if (p === "default") return (await Notification.requestPermission()) as OfficePermission;
  return p;
}

export function disableOfficeNotifications() {
  setOptIn(false);
}

export function createWebNotificationAdapter(): OfficeNotificationService {
  return {
    getPermission: permission,
    requestPermission: enableOfficeNotifications,
    isOptedIn: getNotificationsOptIn,
    setOptedIn: setOptIn,
    // Outra aba, Chrome minimizado ou outro programa em foco = segundo plano.
    isAppHidden: () =>
      typeof document !== "undefined" &&
      (document.visibilityState === "hidden" || (typeof document.hasFocus === "function" && !document.hasFocus())),
    focusApp: () => { try { window.focus(); } catch { /* ignore */ } },
    notify(n) {
      if (permission() !== "granted") return;
      const opts: NotificationOptions & { requireInteraction?: boolean } = {
        body: n.body,
        tag: n.tag,
        silent: n.silent ?? false,
        requireInteraction: n.requireInteraction ?? false,
      };
      let note: Notification;
      try { note = new Notification(n.title, opts); }
      catch { note = new Notification(n.title, { body: n.body, tag: n.tag }); }
      note.onclick = () => {
        try { window.focus(); } catch { /* ignore */ }
        note.close();
        n.onClick?.();
      };
    },
  };
}
