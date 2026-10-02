import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { clampPage, pageSlice, planGrid, readMeetingUiV2Flag, resolveMeetingDisplayMode } from "../layout";
import { createFollowRequestCenter, type FollowPresenter } from "@/lib/notifications/follow-requests";

const W = 1600, H = 900;

describe("meetingDisplayMode", () => {
  it("lobby => office", () => expect(resolveMeetingDisplayMode({ inPrivateRoom: false, hasScreenShare: false })).toBe("office"));
  it("private room => meeting", () => expect(resolveMeetingDisplayMode({ inPrivateRoom: true, hasScreenShare: false })).toBe("meeting"));
  it("screen share => presentation", () => expect(resolveMeetingDisplayMode({ inPrivateRoom: true, hasScreenShare: true })).toBe("presentation"));
  it("share termina => meeting; sai da sala => office", () => {
    expect(resolveMeetingDisplayMode({ inPrivateRoom: true, hasScreenShare: false })).toBe("meeting");
    expect(resolveMeetingDisplayMode({ inPrivateRoom: false, hasScreenShare: false })).toBe("office");
  });
  it("flag permite rollback visual", () => {
    expect(readMeetingUiV2Flag("true")).toBe(true);
    expect(readMeetingUiV2Flag("false")).toBe(false);
    expect(readMeetingUiV2Flag(undefined)).toBe(false);
  });
});

describe("grid", () => {
  it.each([
    [1, 1, 1], [2, 2, 1], [4, 2, 2], [5, 3, 2], [6, 3, 2], [9, 3, 3],
  ])("%i pessoas → %ix%i, sem paginação", (n, cols, rows) => {
    const g = planGrid(n, W, H);
    expect([g.cols, g.rows, g.pages]).toEqual([cols, rows, 1]);
  });
  it("12 pessoas usa paginação", () => {
    const g = planGrid(12, W, H);
    expect(g.perPage).toBe(9);
    expect(g.pages).toBe(2);
    const all = Array.from({ length: 12 }, (_, i) => i);
    expect(pageSlice(all, 1, g.perPage)).toEqual([9, 10, 11]);
    expect(clampPage(5, g.pages)).toBe(1);
  });
  it("viewport pequena limita por página (tile mínimo legível)", () => {
    const g = planGrid(9, 700, 400);
    expect(g.perPage).toBeLessThan(9);
    expect(g.pages).toBeGreaterThan(1);
  });
});

describe("MeetingStage não toca RTC", () => {
  const src = readFileSync("src/components/office/MeetingStage.tsx", "utf8");
  it("sem imports de RTC/LiveKit/privacy/gravação", () => {
    expect(src).not.toMatch(/livekit|@\/lib\/rtc|privacy|egress|recorder|subscribe/i);
  });
  it("roster, filmstrip inferior/lateral, recolher e foco existem", () => {
    for (const s of ["meeting-roster", '"side" : "bottom"', "Recolher participantes", "Voltar ao grid", "Ver escritório"]) expect(src).toContain(s);
  });
  it("cleanup do attachment visual ao trocar layout", () => expect(src).toContain("el.srcObject = null"));
});

describe("Privacy Guard prompt", () => {
  const scene = readFileSync("src/components/office/OfficeScene.tsx", "utf8");
  it("texto fixo exato e protegido contra tradução automática", () => {
    expect(scene).toMatch(/>\s*Reativar dispositivos\s*</);
    expect(scene).toMatch(/role="alertdialog"\s*\n\s*translate="no"/);
    expect(readFileSync("src/routes/__root.tsx", "utf8")).toContain('lang="pt-BR"');
  });
});

function presenter(over: Partial<FollowPresenter> = {}) {
  const p = {
    showToast: vi.fn(), playSound: vi.fn(), isHidden: vi.fn(() => false),
    notificationPermission: vi.fn(() => "granted" as const), notificationsOptIn: vi.fn(() => true),
    showSystemNotification: vi.fn(), ...over,
  };
  return p;
}

describe("Follow requests", () => {
  it("toast com remetente correto + som uma vez, sem notification com aba visível", () => {
    const p = presenter(); const c = createFollowRequestCenter(p);
    c.receive({ fromUid: "m", fromName: "Márcio", at: 1000 });
    expect(p.showToast).toHaveBeenCalledWith(expect.objectContaining({ fromName: "Márcio" }), false);
    expect(p.playSound).toHaveBeenCalledTimes(1);
    expect(p.showSystemNotification).not.toHaveBeenCalled();
  });
  it("som bloqueado não perde o pedido", () => {
    const p = presenter({ playSound: vi.fn(() => { throw new Error("blocked"); }) });
    const c = createFollowRequestCenter(p);
    c.receive({ fromUid: "m", fromName: "M", at: 0 });
    expect(c.pending()).toHaveLength(1);
  });
  it("aba hidden: notification só se granted + opt-in", () => {
    const g = presenter({ isHidden: vi.fn(() => true) });
    createFollowRequestCenter(g).receive({ fromUid: "m", fromName: "M", at: 0 });
    expect(g.showSystemNotification).toHaveBeenCalledTimes(1);
    const d = presenter({ isHidden: vi.fn(() => true), notificationPermission: vi.fn(() => "denied" as const) });
    const c = createFollowRequestCenter(d);
    c.receive({ fromUid: "m", fromName: "M", at: 0 });
    expect(d.showSystemNotification).not.toHaveBeenCalled();
    expect(d.showToast).toHaveBeenCalled();
    expect(c.pending()).toHaveLength(1);
  });
  it("repetidos do mesmo remetente não geram spam; outros remetentes não se perdem", () => {
    const p = presenter(); const c = createFollowRequestCenter(p);
    c.receive({ fromUid: "m", fromName: "M", at: 0 });
    c.receive({ fromUid: "m", fromName: "M", at: 1000 });
    c.receive({ fromUid: "a", fromName: "A", at: 1500 });
    expect(p.playSound).toHaveBeenCalledTimes(2);
    expect(p.showToast).toHaveBeenNthCalledWith(2, expect.anything(), true);
    expect(c.pending()).toHaveLength(2);
  });
  it("receber não segue automaticamente; 'Agora não' só descarta", () => {
    const c = createFollowRequestCenter(presenter());
    c.receive({ fromUid: "m", fromName: "M", at: 0 });
    c.resolve("m");
    expect(c.pending()).toHaveLength(0);
  });
  it("módulo de notificação não importa RTC", () => {
    const src = readFileSync("src/lib/notifications/follow-requests.ts", "utf8");
    expect(src).not.toMatch(/from\s+["']@\/lib\/rtc|livekit/i);
  });
});
