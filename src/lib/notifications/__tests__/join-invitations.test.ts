import { describe, it, expect, vi } from "vitest";
import { createJoinInviteCenter, JOIN_INVITE_TTL_MS } from "../join-invitations";
import type { OfficeNotification, OfficeNotificationService } from "../notification-service";

function setup(bg: boolean) {
  let t = 1000;
  const notes: OfficeNotification[] = [];
  const svc: OfficeNotificationService = {
    getPermission: () => "granted", requestPermission: async () => "granted",
    isOptedIn: () => true, setOptedIn: () => {}, isAppHidden: () => bg,
    notify: (n) => notes.push(n), focusApp: vi.fn(),
  };
  const state = { bg };
  const showPopup = vi.fn(); const playSound = vi.fn();
  const accept = vi.fn(); const teleport = vi.fn();
  const c = createJoinInviteCenter({ service: () => svc, showPopup, playSound, isBackground: () => state.bg, now: () => t });
  const inv = { fromUid: "m", fromName: "Márcio", fromPos: { x: 1, y: 2 }, at: t };
  return { c, svc, notes, showPopup, playSound, accept, teleport, inv, state, tick: (ms: number) => { t += ms; } };
}

describe("join invitations", () => {
  it("foreground mantém popup e não cria notificação", () => {
    const s = setup(false); s.c.receive(s.inv);
    expect(s.showPopup).toHaveBeenCalledTimes(1); expect(s.notes).toHaveLength(0); expect(s.playSound).not.toHaveBeenCalled();
  });
  it("background (hidden ou sem foco) chama o serviço com som e texto corretos", () => {
    const s = setup(true); s.c.receive(s.inv);
    expect(s.notes).toHaveLength(1);
    expect(s.notes[0]).toMatchObject({ title: "Prestativa Office", body: "Márcio está chamando você para se juntar a ele.", silent: false, requireInteraction: true });
    expect(s.playSound).toHaveBeenCalledTimes(1);
  });
  it("duplicata do mesmo remetente não gera spam", () => {
    const s = setup(true); s.c.receive(s.inv); s.tick(1000); s.c.receive(s.inv);
    expect(s.notes).toHaveLength(1); expect(s.playSound).toHaveBeenCalledTimes(1);
  });
  it("clique só foca e reabre popup, sem aceitar/teleportar", () => {
    const s = setup(true); s.c.receive(s.inv); s.state.bg = false;
    s.notes[0].onClick?.();
    expect(s.svc.focusApp).toHaveBeenCalled();
    expect(s.showPopup).toHaveBeenCalledTimes(2);
    expect(s.c.getPending("m")).not.toBeNull();
  });
  it("ao voltar ao Office reabre convite válido; expirado não", () => {
    const s = setup(true); s.c.receive(s.inv); s.state.bg = false;
    s.c.onAppVisible(); expect(s.showPopup).toHaveBeenCalledTimes(2);
    const s2 = setup(true); s2.c.receive(s2.inv); s2.tick(JOIN_INVITE_TTL_MS + 1); s2.c.onAppVisible();
    expect(s2.showPopup).toHaveBeenCalledTimes(1);
  });
  it("Aceitar/Recusar resolvem o convite e nada reabre", () => {
    const s = setup(true); s.c.receive(s.inv); s.c.resolve("m"); s.c.onAppVisible();
    expect(s.c.getPending("m")).toBeNull(); expect(s.showPopup).toHaveBeenCalledTimes(1);
  });
});
