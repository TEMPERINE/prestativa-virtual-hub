// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";
import {
  createFollowRequestCenter,
  FOLLOW_MISSED_TTL_MS,
  FOLLOW_POPUP_MS,
  presenterFromService,
} from "../follow-requests";
import type { OfficeNotificationService, OfficePermission } from "../notification-service";
import { isNotificationSetupDone, markNotificationSetupDone } from "../notification-service";
import { FollowRequestsOverlay } from "@/components/office/FollowRequestsOverlay";
import { NotificationsStep } from "@/components/onboarding/NotificationsStep";

function svc(over: Partial<OfficeNotificationService> & { perm?: OfficePermission; hidden?: boolean } = {}) {
  let perm: OfficePermission = over.perm ?? "default";
  let opt = false;
  const s: OfficeNotificationService = {
    getPermission: () => perm,
    requestPermission: vi.fn(async () => { opt = true; if (perm === "default") perm = "granted"; return perm; }),
    isOptedIn: () => opt || perm === "granted",
    setOptedIn: (v) => { opt = v; },
    isAppHidden: () => over.hidden ?? false,
    notify: vi.fn(),
    focusApp: vi.fn(),
    ...over,
  };
  return s;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanup(); vi.useRealTimers(); localStorage.clear(); });

function setup(s = svc()) {
  const sound = vi.fn();
  const c = createFollowRequestCenter(presenterFromService(s, sound));
  const onFollow = vi.fn();
  const onDecline = vi.fn();
  render(createElement(FollowRequestsOverlay, { center: c, onFollow, onDecline }));
  return { c, s, sound, onFollow, onDecline };
}
const recv = (c: ReturnType<typeof createFollowRequestCenter>, uid = "m", name = "Márcio") =>
  act(() => c.receive({ fromUid: uid, fromName: name, at: Date.now() }));

describe("Follow request persistente", () => {
  it("1/2/3. abre popup, não some em timeout curto, fecha só aos 30s", () => {
    const { c } = setup();
    recv(c);
    expect(screen.getByText("Márcio chamou você")).toBeTruthy();
    act(() => void vi.advanceTimersByTime(20_000));
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    act(() => void vi.advanceTimersByTime(FOLLOW_POPUP_MS - 20_000));
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
  it("4. Seguir executa o comportamento existente", () => {
    const { c, onFollow } = setup();
    recv(c);
    fireEvent.click(screen.getByText("Seguir"));
    expect(onFollow).toHaveBeenCalledWith("m");
    expect(c.entries()).toHaveLength(0);
  });
  it("5. Agora não encerra o pedido sem seguir", () => {
    const { c, onFollow, onDecline } = setup();
    recv(c);
    fireEvent.click(screen.getByText("Agora não"));
    expect(onDecline).toHaveBeenCalledWith("m");
    expect(onFollow).not.toHaveBeenCalled();
    expect(c.entries()).toHaveLength(0);
  });
  it("6/7. expiração vira indicador '1 chamado' que reabre com Seguir/Dispensar", () => {
    const { c, onFollow } = setup();
    recv(c);
    act(() => void vi.advanceTimersByTime(FOLLOW_POPUP_MS));
    fireEvent.click(screen.getByText("1 chamado"));
    expect(screen.getByText("Dispensar")).toBeTruthy();
    fireEvent.click(screen.getByText("Seguir"));
    expect(onFollow).toHaveBeenCalledWith("m");
  });
  it("chamado perdido é descartado após alguns minutos (sem histórico)", () => {
    const { c } = setup();
    recv(c);
    act(() => void vi.advanceTimersByTime(FOLLOW_POPUP_MS + FOLLOW_MISSED_TTL_MS));
    expect(c.entries()).toHaveLength(0);
  });
  it("8/9/10. mesma pessoa não empilha nem toca de novo; outra pessoa é independente", () => {
    const { c, sound } = setup();
    recv(c);
    act(() => void vi.advanceTimersByTime(1000));
    recv(c);
    expect(screen.getAllByRole("alertdialog")).toHaveLength(1);
    expect(sound).toHaveBeenCalledTimes(1);
    act(() => void vi.advanceTimersByTime(20_000)); // pendente não repete som
    expect(sound).toHaveBeenCalledTimes(1);
    recv(c, "a", "Ana");
    expect(screen.getAllByRole("alertdialog")).toHaveLength(2);
    expect(sound).toHaveBeenCalledTimes(2);
  });
  it("17/19. aba hidden + permissão: notification do sistema; clique só reabre, não segue", () => {
    const s = svc({ perm: "granted", hidden: true });
    const { c, onFollow } = setup(s);
    recv(c);
    expect(s.notify).toHaveBeenCalledTimes(1);
    act(() => void vi.advanceTimersByTime(FOLLOW_POPUP_MS));
    const arg = (s.notify as ReturnType<typeof vi.fn>).mock.calls[0][0];
    act(() => arg.onClick());
    expect(onFollow).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog")).toBeTruthy();
  });
  it("18. sem permissão: só aviso interno", () => {
    const s = svc({ perm: "denied", hidden: true });
    const { c } = setup(s);
    recv(c);
    expect(s.notify).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog")).toBeTruthy();
  });
  it("20. serviço/centro não dependem de RTC nem da Notification API", () => {
    for (const f of ["follow-requests.ts", "notification-service.ts"]) {
      const src = readFileSync(`src/lib/notifications/${f}`, "utf8");
      expect(src).not.toMatch(/@\/lib\/rtc|livekit/i);
    }
    expect(readFileSync("src/lib/notifications/follow-requests.ts", "utf8")).not.toMatch(/new Notification|Notification\.request/);
  });
});

describe("Onboarding de notificações", () => {
  it("11/12/13. não pede ao montar; clique pede; granted conclui", async () => {
    const s = svc();
    render(createElement(NotificationsStep, { service: s }));
    expect(s.requestPermission).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(screen.getByText("Ativar notificações")); });
    expect(s.requestPermission).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Notificações ativadas/)).toBeTruthy();
  });
  it("14. denied não bloqueia e explica configurações", () => {
    const s = svc({ perm: "denied" });
    render(createElement(NotificationsStep, { service: s }));
    expect(screen.getByText(/configurações do navegador/)).toBeTruthy();
    expect(screen.queryByText("Ativar notificações")).toBeNull();
  });
  it("15. já granted não pede de novo", () => {
    const s = svc({ perm: "granted" });
    render(createElement(NotificationsStep, { service: s }));
    expect(screen.getByText(/Notificações ativadas/)).toBeTruthy();
    expect(s.requestPermission).not.toHaveBeenCalled();
  });
  it("16. usuários antigos: só flag local da etapa, sem resetar personagem", () => {
    expect(isNotificationSetupDone("u1")).toBe(false);
    markNotificationSetupDone("u1");
    expect(isNotificationSetupDone("u1")).toBe(true);
    const prompt = readFileSync("src/components/onboarding/NotificationsPrompt.tsx", "utf8");
    expect(prompt).not.toMatch(/sprite_id|onboarded_at|supabase/);
  });
});
