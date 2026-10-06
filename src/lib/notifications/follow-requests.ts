/**
 * FollowRequestReceived — evento de negócio separado da apresentação.
 *
 * O centro guarda o estado (popup pendente → chamado perdido) e nunca conhece
 * a Notification API: a camada de apresentação injeta um OfficeNotificationService
 * (hoje WebNotificationAdapter; futuramente DesktopNotificationAdapter).
 * Nada aqui chama RTC, mídia ou movimento.
 */
import type { OfficeNotificationService } from "./notification-service";

export type FollowRequestReceived = { fromUid: string; fromName: string; at: number };

export type FollowRequestEntry = FollowRequestReceived & {
  /** "pending" = popup visível; "missed" = expirou sem resposta, vira indicador. */
  status: "pending" | "missed";
  /** Quando o popup expira (pending) ou quando o chamado é descartado (missed). */
  expiresAt: number;
};

/**
 * Presenter legado/injetável. Os campos da apresentação web vêm do
 * OfficeNotificationService; `showToast` é só um gancho opcional.
 */
export type FollowPresenter = {
  showToast?: (req: FollowRequestReceived, isUpdate: boolean) => void;
  playSound: () => Promise<void> | void;
  isHidden: () => boolean;
  notificationPermission: () => NotificationPermission | "unsupported";
  notificationsOptIn: () => boolean;
  showSystemNotification: (req: FollowRequestReceived, onClick?: () => void) => void;
};

export type FollowTimers = {
  now: () => number;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (h: unknown) => void;
};

export const FOLLOW_COALESCE_MS = 5000;
/** Popup permanece até Seguir / Agora não / 30s. */
export const FOLLOW_POPUP_MS = 30_000;
/** Chamado perdido fica no indicador por pouco tempo (não é histórico). */
export const FOLLOW_MISSED_TTL_MS = 5 * 60_000;

const realTimers: FollowTimers = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (h) => globalThis.clearTimeout(h as ReturnType<typeof setTimeout>),
};

export function presenterFromService(
  svc: OfficeNotificationService,
  playSound: () => Promise<void> | void,
): FollowPresenter {
  return {
    playSound,
    isHidden: () => svc.isAppHidden(),
    notificationPermission: () => svc.getPermission(),
    notificationsOptIn: () => svc.isOptedIn(),
    showSystemNotification: (req, onClick) =>
      svc.notify({
        title: "Prestativa Office",
        body: `${req.fromName} está chamando você para se juntar a ele.`,
        tag: `follow-${req.fromUid}`,
        requireInteraction: true,
        silent: false,
        // Só foca e reabre o pedido — nunca aceita/teletransporta.
        onClick: () => { try { svc.focusApp(); } catch { /* ignore */ } onClick?.(); },
      }),
  };
}

export function createFollowRequestCenter(
  presenter: FollowPresenter,
  opts: { timers?: FollowTimers; onReveal?: (fromUid: string) => void } = {},
) {
  const t = opts.timers ?? realTimers;
  const entries = new Map<string, FollowRequestEntry>();
  const timers = new Map<string, unknown>();
  const lastAlert = new Map<string, number>();
  const listeners = new Set<() => void>();
  let snapshot: FollowRequestEntry[] = [];
  let revealed: string | null = null;
  /** Chamados recebidos com o Office em segundo plano — reabrem ao voltar. */
  const awayRequests = new Set<string>();

  const emit = () => {
    snapshot = [...entries.values()].sort((a, b) => b.at - a.at);
    for (const l of listeners) l();
  };
  const clearTimer = (uid: string) => {
    const h = timers.get(uid);
    if (h !== undefined) t.clearTimeout(h);
    timers.delete(uid);
  };
  const schedule = (uid: string, ms: number, fn: () => void) => {
    clearTimer(uid);
    timers.set(uid, t.setTimeout(() => { timers.delete(uid); fn(); }, ms));
  };

  function expire(uid: string) {
    const e = entries.get(uid);
    if (!e || e.status !== "pending") return;
    const missed: FollowRequestEntry = { ...e, status: "missed", expiresAt: t.now() + FOLLOW_MISSED_TTL_MS };
    entries.set(uid, missed);
    schedule(uid, FOLLOW_MISSED_TTL_MS, () => { entries.delete(uid); emit(); });
    emit();
  }

  function showPending(req: FollowRequestReceived) {
    entries.set(req.fromUid, { ...req, status: "pending", expiresAt: t.now() + FOLLOW_POPUP_MS });
    schedule(req.fromUid, FOLLOW_POPUP_MS, () => expire(req.fromUid));
  }

  function receive(req: FollowRequestReceived) {
    const isUpdate = entries.has(req.fromUid);
    showPending(req);
    try { presenter.showToast?.(req, isUpdate); } catch { /* ignore */ }
    emit();
    const last = lastAlert.get(req.fromUid) ?? -Infinity;
    let away = false;
    try { away = presenter.isHidden(); } catch { /* ignore */ }
    if (away) awayRequests.add(req.fromUid);
    if (req.at - last < FOLLOW_COALESCE_MS) return; // coalesce: sem som/notificação repetidos
    lastAlert.set(req.fromUid, req.at);
    try {
      const r = presenter.playSound();
      if (r && typeof (r as Promise<void>).catch === "function") (r as Promise<void>).catch(() => {});
    } catch { /* som bloqueado não perde o pedido */ }
    if (
      away &&
      presenter.notificationsOptIn() &&
      presenter.notificationPermission() === "granted"
    ) {
      try {
        // Clique só traz o Office e mostra o pedido; nunca segue automaticamente.
        presenter.showSystemNotification(req, () => reveal(req.fromUid));
      } catch { /* ignore */ }
    }
  }

  /** Reabre um chamado (perdido ou pendente) como popup. Não segue. */
  function reveal(fromUid: string) {
    const e = entries.get(fromUid);
    if (!e) return;
    showPending({ fromUid: e.fromUid, fromName: e.fromName, at: e.at });
    revealed = fromUid;
    opts.onReveal?.(fromUid);
    emit();
  }

  /** Usuário voltou ao Office: reabre como popup o que chegou em segundo plano. */
  function onAppVisible() {
    const uids = [...awayRequests];
    awayRequests.clear();
    for (const uid of uids) {
      const e = entries.get(uid);
      if (e) showPending({ fromUid: e.fromUid, fromName: e.fromName, at: e.at });
    }
    if (uids.length) emit();
  }

  /** Seguir / Agora não / Dispensar: encerra o chamado. */
  function resolve(fromUid: string) {
    awayRequests.delete(fromUid);
    clearTimer(fromUid);
    if (entries.delete(fromUid)) emit();
  }

  function dispose() {
    for (const uid of [...timers.keys()]) clearTimer(uid);
    entries.clear();
    awayRequests.clear();
    listeners.clear();
    snapshot = [];
  }

  return {
    receive,
    resolve,
    onAppVisible,
    reveal,
    dispose,
    /** Popups visíveis. */
    pending: () => snapshot.filter((e) => e.status === "pending"),
    /** Chamados que expiraram sem resposta (indicador). */
    missed: () => snapshot.filter((e) => e.status === "missed"),
    entries: () => snapshot,
    lastRevealed: () => revealed,
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => { listeners.delete(fn); };
    },
  };
}

export type FollowRequestCenter = ReturnType<typeof createFollowRequestCenter>;

// ===== Compat: opt-in do menu de perfil (delegam ao adapter web) =====
export {
  getNotificationsOptIn,
  enableOfficeNotifications,
  disableOfficeNotifications,
} from "./web-notification-adapter";

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
