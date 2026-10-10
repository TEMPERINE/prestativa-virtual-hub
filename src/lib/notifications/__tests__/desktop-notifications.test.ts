// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDesktopNotificationAdapter, type DesktopNotificationBridge } from "../desktop-notification-adapter";
import { createOfficeNotificationAdapter } from "../office-notification-adapter";
import { createJoinInviteCenter } from "../join-invitations";
import { createWebNotificationAdapter } from "../web-notification-adapter";
import { clearNotificationService, getNotificationService, setNotificationService } from "../notification-service";
import { enableOfficeNotifications, disableOfficeNotifications } from "../follow-requests";

afterEach(() => { clearNotificationService(getNotificationService()); localStorage.clear(); vi.useRealTimers(); vi.restoreAllMocks(); delete window.prestativaDesktop; });

function setup(background = true, supported = true) {
  vi.spyOn(document, "hasFocus").mockReturnValue(!background);
  const delivered: Array<{ tag: string; title: string; body: string }> = [];
  const listeners = new Set<(tag: string) => void>();
  let focused = false;
  const bridge: DesktopNotificationBridge = {
    getState: () => ({ background, supported }),
    show: async (n) => { delivered.push(n); return true; },
    focus: async () => { focused = true; return true; },
    clear: async () => { delivered.length = 0; },
    onClick: fn => { listeners.add(fn); return () => { listeners.delete(fn); }; },
  };
  const adapter = createDesktopNotificationAdapter(bridge);
  adapter.setOptedIn(true);
  const popups: unknown[] = [];
  const center = createJoinInviteCenter({ service: () => adapter, isBackground: () => adapter.isAppHidden(), showPopup: inv => popups.push(inv), playSound: () => {} });
  const invite = { fromUid: "ana", fromName: "Ana", fromPos: { x: 10, y: 20 }, at: Date.now() };
  return { adapter, bridge, delivered, listeners, popups, center, invite, focused: () => focused, click: () => listeners.forEach(fn => fn("join-ana")) };
}

describe("Desktop adapter uses the existing invitation center", () => {
  it("unsupported native API still routes to Electron for taskbar attention", () => {
    const s = setup(true, false); s.center.receive(s.invite);
    expect(s.adapter.getPermission()).toBe("unsupported");
    expect(s.delivered).toHaveLength(1); expect(s.popups).toEqual([s.invite]);
    s.adapter.dispose?.();
  });
  it("failed IPC discards its restore callback without changing pending invite", async () => {
    const s = setup();
    vi.spyOn(console, "error").mockImplementation(() => {});
    s.bridge.show = async () => { throw new Error("IPC unavailable"); };
    s.center.receive(s.invite); await Promise.resolve(); await Promise.resolve(); s.click();
    expect(s.popups).toEqual([s.invite]); expect(s.center.getPending("ana")).toBe(s.invite);
    s.adapter.dispose?.();
  });
  it("foreground keeps internal popup without system notification", () => {
    const s = setup(false); s.center.receive(s.invite);
    expect(s.popups).toEqual([s.invite]); expect(s.delivered).toHaveLength(0);
    s.adapter.dispose?.();
  });
  it("background delivers native request and click restores the same pending invite", () => {
    Object.defineProperty(navigator, "serviceWorker", { configurable: true, get: () => undefined });
    const sw = vi.spyOn(navigator, "serviceWorker", "get");
    const s = setup(); s.center.receive(s.invite);
    expect(s.delivered[0]).toMatchObject({ title: "Prestativa Office", body: "Ana está chamando você para se juntar a ele.", tag: "join-ana" });
    s.click();
    expect(s.focused()).toBe(true);
    expect(s.popups).toEqual([s.invite, s.invite]);
    expect(s.center.getPending("ana")).toBe(s.invite);
    expect(s.invite.fromPos).toEqual({ x: 10, y: 20 });
    expect(sw).not.toHaveBeenCalled();
    s.adapter.dispose?.();
  });
  it("resolved invitation cannot be re-created by notification click", () => {
    const s = setup(); s.center.receive(s.invite); s.center.resolve("ana"); s.click();
    expect(s.popups).toEqual([s.invite]); expect(s.center.getPending("ana")).toBeNull();
    s.adapter.dispose?.();
  });
  it("expired invitation cannot be re-created by native click", () => {
    vi.useFakeTimers();
    const s = setup(); s.center.receive(s.invite);
    vi.advanceTimersByTime(120_001); s.click();
    expect(s.popups).toEqual([s.invite]); expect(s.center.getPending("ana")).toBeNull();
    s.adapter.dispose?.();
  });
  it("leaving Office removes click subscription and clears native presentation", () => {
    const s = setup(); s.center.receive(s.invite); s.adapter.dispose?.(); s.click();
    expect(s.popups).toEqual([s.invite]); expect(s.listeners.size).toBe(0); expect(s.delivered).toHaveLength(0);
  });
  it("notification opt-in uses the Desktop service rather than browser permission", async () => {
    const s = setup(); setNotificationService(s.adapter);
    expect(await enableOfficeNotifications()).toBe("granted");
    disableOfficeNotifications(); expect(s.adapter.isOptedIn()).toBe(false);
    s.center.receive(s.invite); expect(s.delivered).toHaveLength(0); expect(s.popups).toEqual([s.invite]);
    s.adapter.dispose?.();
  });
  it("browser menu keeps original Web helper instead of service permission side effects", async () => {
    const web = createWebNotificationAdapter();
    const permission = vi.spyOn(web, "requestPermission");
    setNotificationService(web);
    await enableOfficeNotifications();
    expect(permission).not.toHaveBeenCalled();
    expect(localStorage.getItem("officeNotificationsOptIn")).toBe("1");
    disableOfficeNotifications();
    expect(localStorage.getItem("officeNotificationsOptIn")).toBeNull();
  });
  it("older EXE with Electron bridge but no notification capability keeps Web adapter", () => {
    const s = setup(false);
    window.prestativaDesktop = { isDesktop: true };
    const adapter = createOfficeNotificationAdapter();
    expect(adapter.kind).not.toBe("desktop");
    expect(adapter.getPermission()).toBe(createWebNotificationAdapter().getPermission());
    expect(adapter.isAppHidden()).toBe(createWebNotificationAdapter().isAppHidden());
    s.adapter.dispose?.();
  });
  it("factory uses native capability only; ordinary browser keeps Web adapter", () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    const s = setup();
    window.prestativaDesktop = { isDesktop: true, notifications: s.bridge };
    expect(createOfficeNotificationAdapter().isAppHidden()).toBe(true);
    delete window.prestativaDesktop;
    const web = createOfficeNotificationAdapter();
    expect(web.isAppHidden()).toBe(createWebNotificationAdapter().isAppHidden());
    expect(web.getPermission()).toBe(createWebNotificationAdapter().getPermission());
    s.adapter.dispose?.();
  });
});
