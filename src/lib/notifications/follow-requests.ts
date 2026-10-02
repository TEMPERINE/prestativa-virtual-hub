/**
 * FollowRequestReceived — evento de negócio separado da apresentação.
 * A camada web decide como apresentar (toast, som, Notification do sistema);
 * nada aqui chama RTC, mídia ou movimento.
 */
export type FollowRequestReceived = { fromUid: string; fromName: string; at: number };

export type FollowPresenter = {
  showToast: (req: FollowRequestReceived, isUpdate: boolean) => void;
  playSound: () => Promise<void> | void;
  isHidden: () => boolean;
  notificationPermission: () => NotificationPermission | "unsupported";
  notificationsOptIn: () => boolean;
  showSystemNotification: (req: FollowRequestReceived) => void;
};

export const FOLLOW_COALESCE_MS = 5000;

export function createFollowRequestCenter(presenter: FollowPresenter) {
  const pending = new Map<string, FollowRequestReceived>();
  const lastAlert = new Map<string, number>();

  function receive(req: FollowRequestReceived) {
    const isUpdate = pending.has(req.fromUid);
    pending.set(req.fromUid, req);
    presenter.showToast(req, isUpdate);
    const last = lastAlert.get(req.fromUid) ?? -Infinity;
    if (req.at - last < FOLLOW_COALESCE_MS) return; // coalesce: sem som/notificação repetidos
    lastAlert.set(req.fromUid, req.at);
    try {
      const r = presenter.playSound();
      if (r && typeof (r as Promise<void>).catch === "function") (r as Promise<void>).catch(() => {});
    } catch { /* som bloqueado não perde o pedido */ }
    if (
      presenter.isHidden() &&
      presenter.notificationsOptIn() &&
      presenter.notificationPermission() === "granted"
    ) {
      try { presenter.showSystemNotification(req); } catch { /* ignore */ }
    }
  }

  function resolve(fromUid: string) {
    pending.delete(fromUid);
  }

  return { receive, resolve, pending: () => [...pending.values()] };
}

// ===== Apresentação web =====
const OPT_IN_KEY = "officeNotificationsOptIn";

export function getNotificationsOptIn(): boolean {
  try { return localStorage.getItem(OPT_IN_KEY) === "1"; } catch { return false; }
}

/** Só chamado por ação consciente do usuário. */
export async function enableOfficeNotifications(): Promise<NotificationPermission | "unsupported"> {
  try { localStorage.setItem(OPT_IN_KEY, "1"); } catch { /* ignore */ }
  if (typeof Notification === "undefined") return "unsupported";
  if (Notification.permission === "default") return Notification.requestPermission();
  return Notification.permission;
}

export function disableOfficeNotifications() {
  try { localStorage.removeItem(OPT_IN_KEY); } catch { /* ignore */ }
}

let audioCtx: AudioContext | null = null;
/** Prepara o som após a primeira interação válida (política de autoplay). */
export function primeNotificationSound() {
  if (typeof window === "undefined") return;
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    audioCtx ??= new Ctor();
    if (audioCtx.state === "suspended") void audioCtx.resume().catch(() => {});
  } catch { /* ignore */ }
}

/** Dois toques curtos e discretos. */
export async function playFollowChime(): Promise<void> {
  if (!audioCtx || audioCtx.state !== "running") return;
  const ctx = audioCtx;
  const t0 = ctx.currentTime;
  [880, 1320].forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    const s = t0 + i * 0.16;
    gain.gain.setValueAtTime(0.0001, s);
    gain.gain.exponentialRampToValueAtTime(0.15, s + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, s + 0.22);
    osc.connect(gain).connect(ctx.destination);
    osc.start(s);
    osc.stop(s + 0.25);
  });
}
