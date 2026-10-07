/**
 * Convites "quer que você se junte a ele(a)" (broadcast join-request).
 * Estado pendente fora do componente visual; em segundo plano dispara a
 * notificação de sistema via OfficeNotificationService já existente.
 * Clicar na notificação só foca e reabre o popup — nunca aceita/teleporta.
 */
import type { OfficeNotificationService } from "./notification-service";
import { notifyTrace } from "./web-notification-adapter";

export type Point = { x: number; y: number };
export type JoinInvite = { fromUid: string; fromName: string; fromPos: Point; at: number };

export const JOIN_INVITE_TTL_MS = 120_000;
export const JOIN_DEDUP_MS = 5_000;

export type JoinInviteDeps = {
  service: () => OfficeNotificationService | null;
  showPopup: (inv: JoinInvite) => void;
  playSound: () => void;
  isBackground?: () => boolean;
  now?: () => number;
};

export function createJoinInviteCenter(deps: JoinInviteDeps) {
  const now = deps.now ?? (() => Date.now());
  const isBg =
    deps.isBackground ??
    (() =>
      typeof document !== "undefined" &&
      (document.visibilityState === "hidden" || (typeof document.hasFocus === "function" && !document.hasFocus())));
  const pending = new Map<string, JoinInvite>();
  const lastAlert = new Map<string, number>();
  const shownWhileVisible = new Set<string>();

  const valid = (inv: JoinInvite) => now() - inv.at < JOIN_INVITE_TTL_MS;

  function receive(inv: JoinInvite) {
    pending.set(inv.fromUid, inv);
    const bg = isBg();
    const svc = deps.service();
    notifyTrace("join invitation received", {
      sender: inv.fromName,
      notificationsEnabled: svc?.isOptedIn() ?? false,
      serviceWorkerReady: typeof navigator !== "undefined" && "serviceWorker" in navigator && !!navigator.serviceWorker.controller,
      adapterUsed: svc ? "OfficeNotificationService(web)" : "none",
      background: bg,
    });
    // Popup atual sempre mantido.
    deps.showPopup(inv);
    if (!bg) shownWhileVisible.add(inv.fromUid);
    else shownWhileVisible.delete(inv.fromUid);

    const last = lastAlert.get(inv.fromUid);
    if (last !== undefined && now() - last < JOIN_DEDUP_MS) return; // sem spam/som repetido
    lastAlert.set(inv.fromUid, now());
    if (!bg) return;
    deps.playSound();
    if (!svc) return;
    notifyTrace("system notification attempted", { sender: inv.fromName });
    try {
      svc.notify({
        title: "Prestativa Office",
        body: `${inv.fromName} está chamando você para se juntar a ele.`,
        tag: `join-${inv.fromUid}`,
        requireInteraction: true,
        silent: false,
        onClick: () => {
          svc.focusApp();
          restore(inv.fromUid);
        },
      });
    } catch (e) {
      notifyTrace("system notification error", { error: String(e) });
    }
  }

  function restore(fromUid: string) {
    const inv = pending.get(fromUid);
    if (!inv || !valid(inv)) { pending.delete(fromUid); return; }
    shownWhileVisible.add(fromUid);
    deps.showPopup(inv);
  }

  /** Ao voltar ao Office: reabre convites válidos recebidos em segundo plano. */
  function onAppVisible() {
    for (const [uid, inv] of [...pending]) {
      if (!valid(inv)) { pending.delete(uid); continue; }
      if (!shownWhileVisible.has(uid)) restore(uid);
    }
  }

  function resolve(fromUid: string) {
    pending.delete(fromUid);
    shownWhileVisible.delete(fromUid);
  }

  return { receive, restore, onAppVisible, resolve, getPending: (u: string) => pending.get(u) ?? null };
}
export type JoinInviteCenter = ReturnType<typeof createJoinInviteCenter>;
