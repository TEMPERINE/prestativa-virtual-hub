import type { OfficeNotificationService, OfficePermission } from "./notification-service";

const OPT_IN_KEY = "officeNotificationsOptIn";
const SW_URL = "/office-notify-sw.js";
const SW_SCOPE = "/__office-notify/";

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

/** Trace temporário de diagnóstico (console). Sem dados sensíveis. */
export function notifyTrace(step: string, extra: Record<string, unknown> = {}) {
  try {
    console.info("[office-notify]", step, {
      permission: permission(),
      visibilityState: typeof document !== "undefined" ? document.visibilityState : "n/a",
      hasFocus: typeof document !== "undefined" && typeof document.hasFocus === "function" ? document.hasFocus() : "n/a",
      adapter: "web",
      notificationAvailable: typeof Notification !== "undefined",
      serviceWorkerAvailable: typeof navigator !== "undefined" && "serviceWorker" in navigator,
      inIframe: typeof window !== "undefined" && window.self !== window.top,
      ...extra,
    });
  } catch { /* ignore */ }
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

// ===== Worker de notificação (escopo estreito, sem cache) =====
let regPromise: Promise<ServiceWorkerRegistration | null> | null = null;
const clickHandlers = new Map<string, () => void>();

function getRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return Promise.resolve(null);
  regPromise ??= (async () => {
    try {
      navigator.serviceWorker.addEventListener("message", (ev) => {
        const d = ev.data as { type?: string; tag?: string } | undefined;
        if (d?.type !== "office-notify-click" || !d.tag) return;
        notifyTrace("click", { api: "ServiceWorkerRegistration.showNotification", tag: d.tag });
        const fn = clickHandlers.get(d.tag);
        clickHandlers.delete(d.tag);
        fn?.();
      });
      const reg = await navigator.serviceWorker.register(SW_URL, { scope: SW_SCOPE });
      if (!reg.active) {
        await new Promise<void>((res) => {
          const w = reg.installing ?? reg.waiting;
          if (!w) return res();
          w.addEventListener("statechange", () => { if (w.state === "activated") res(); });
          setTimeout(res, 3000);
        });
      }
      return reg;
    } catch (err) {
      notifyTrace("sw-register-failed", { error: String(err) });
      return null;
    }
  })();
  return regPromise;
}

export function createWebNotificationAdapter(): OfficeNotificationService {
  // Prepara o worker cedo (não pede permissão, não mostra nada).
  if (permission() === "granted") void getRegistration();
  return {
    getPermission: permission,
    requestPermission: async () => {
      const p = await enableOfficeNotifications();
      if (p === "granted") void getRegistration();
      return p;
    },
    isOptedIn: getNotificationsOptIn,
    setOptedIn: setOptIn,
    // Outra aba, Chrome minimizado ou outro programa em foco = segundo plano.
    isAppHidden: () =>
      typeof document !== "undefined" &&
      (document.visibilityState === "hidden" || (typeof document.hasFocus === "function" && !document.hasFocus())),
    focusApp: () => { try { window.focus(); } catch { /* ignore */ } },
    notify(n) {
      if (permission() !== "granted") {
        notifyTrace("skipped-no-permission", { created: false });
        return;
      }
      const tag = n.tag ?? `office-${Date.now()}`;
      const fromUid = tag.startsWith("follow-") ? tag.slice(7) : undefined;
      const opts: NotificationOptions & { requireInteraction?: boolean } = {
        body: n.body,
        tag,
        silent: n.silent ?? false,
        requireInteraction: n.requireInteraction ?? false,
        data: { tag, fromUid },
      };
      const viaConstructor = (reason: string) => {
        try {
          const note = new Notification(n.title, opts);
          note.onclick = () => {
            try { window.focus(); } catch { /* ignore */ }
            note.close();
            n.onClick?.();
          };
          note.onerror = (e) => notifyTrace("constructor-onerror", { error: String(e) });
          note.onshow = () => notifyTrace("constructor-shown", { api: "new Notification()" });
          notifyTrace("created", { api: "new Notification()", created: true, fallbackReason: reason, tag });
        } catch (err) {
          notifyTrace("create-failed", { api: "new Notification()", created: false, error: String(err) });
        }
      };
      void getRegistration().then(async (reg) => {
        if (!reg) return viaConstructor("no-service-worker");
        try {
          if (n.onClick) clickHandlers.set(tag, n.onClick);
          await reg.showNotification(n.title, opts);
          const shown = await reg.getNotifications({ tag }).catch(() => []);
          notifyTrace("created", {
            api: "ServiceWorkerRegistration.showNotification",
            created: true,
            visibleInRegistry: shown.length,
            tag,
          });
        } catch (err) {
          clickHandlers.delete(tag);
          notifyTrace("sw-show-failed", { error: String(err) });
          viaConstructor("sw-show-failed");
        }
      });
    },
  };
}
