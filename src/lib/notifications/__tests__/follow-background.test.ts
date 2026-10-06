// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createFollowRequestCenter, presenterFromService } from "../follow-requests";
import type { OfficeNotificationService } from "../notification-service";
import { createWebNotificationAdapter } from "../web-notification-adapter";

function svc(hidden: () => boolean, perm: "granted" | "denied" = "granted") {
  return {
    getPermission: () => perm, requestPermission: vi.fn(), isOptedIn: () => true, setOptedIn: vi.fn(),
    isAppHidden: hidden, notify: vi.fn(), focusApp: vi.fn(),
  } as unknown as OfficeNotificationService & { notify: ReturnType<typeof vi.fn>; focusApp: ReturnType<typeof vi.fn> };
}
const req = (at = Date.now()) => ({ fromUid: "m", fromName: "Márcio", at });

afterEach(() => vi.restoreAllMocks());

describe("Chamado em segundo plano", () => {
  it("visível: popup + som, sem notificação do sistema", () => {
    const s = svc(() => false); const sound = vi.fn();
    const c = createFollowRequestCenter(presenterFromService(s, sound));
    c.receive(req());
    expect(c.pending()).toHaveLength(1);
    expect(sound).toHaveBeenCalledTimes(1);
    expect(s.notify).not.toHaveBeenCalled();
  });
  it("hidden/sem foco: notificação com silent:false e requireInteraction:true", () => {
    const s = svc(() => true); const sound = vi.fn();
    createFollowRequestCenter(presenterFromService(s, sound)).receive(req());
    expect(sound).toHaveBeenCalledTimes(1);
    expect(s.notify).toHaveBeenCalledWith(expect.objectContaining({
      silent: false, requireInteraction: true, tag: "follow-m",
      body: "Márcio está chamando você para se juntar a ele.",
    }));
  });
  it("adapter web trata janela sem foco (outro programa/minimizado) como segundo plano", () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
    expect(createWebNotificationAdapter().isAppHidden()).toBe(true);
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    expect(createWebNotificationAdapter().isAppHidden()).toBe(false);
  });
  it("clique foca o Office, reabre o pedido e NÃO aceita", () => {
    const s = svc(() => true); const onReveal = vi.fn();
    const c = createFollowRequestCenter(presenterFromService(s, vi.fn()), { onReveal });
    c.receive(req());
    s.notify.mock.calls[0][0].onClick();
    expect(s.focusApp).toHaveBeenCalled();
    expect(onReveal).toHaveBeenCalledWith("m");
    expect(c.pending()).toHaveLength(1);
  });
  it("voltar ao Office reabre o popup mesmo após expirar", () => {
    vi.useFakeTimers();
    const s = svc(() => true);
    const c = createFollowRequestCenter(presenterFromService(s, vi.fn()));
    c.receive(req());
    vi.advanceTimersByTime(31_000);
    expect(c.pending()).toHaveLength(0);
    expect(c.missed()).toHaveLength(1);
    c.onAppVisible();
    expect(c.pending()).toHaveLength(1);
    vi.useRealTimers();
  });
  it("duplicatas não geram spam de notificações", () => {
    const s = svc(() => true);
    const c = createFollowRequestCenter(presenterFromService(s, vi.fn()));
    c.receive(req(0)); c.receive(req(1000)); c.receive(req(2000));
    expect(s.notify).toHaveBeenCalledTimes(1);
  });
  it("permissão negada não quebra popup/som", () => {
    const s = svc(() => true, "denied"); const sound = vi.fn();
    const c = createFollowRequestCenter(presenterFromService(s, sound));
    c.receive(req());
    expect(s.notify).not.toHaveBeenCalled();
    expect(sound).toHaveBeenCalled();
    expect(c.pending()).toHaveLength(1);
  });
  it("módulos de notificação não importam RTC", () => {
    for (const f of ["follow-requests.ts", "web-notification-adapter.ts", "notification-service.ts"])
      expect(readFileSync(`src/lib/notifications/${f}`, "utf8")).not.toMatch(/@\/lib\/rtc|livekit/i);
  });
});
