import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  MeetingInactivityController,
  MeetingReturnPosition,
  electCoordinator,
  parseMeetingIdleMode,
  IDLE_TIMEOUT_MS,
  WARNING_DURATION_MS,
  type MeetingIdleEvent,
  type MeetingIdleMode,
} from "../meeting-inactivity-controller";
import { MeetingTrackerV2 } from "../meeting-tracker-v2";

/** Rede simulada: vários clientes, relógio comum, timers manuais. */
function net(ids: string[], mode: MeetingIdleMode = "enforce") {
  let t = 1_000_000;
  const clock = { now: () => t, advance: (ms: number) => { t += ms; } };
  const sent: Array<{ from: string; e: MeetingIdleEvent }> = [];
  const ejects: Record<string, number> = {};
  const warnings: Record<string, number> = {};
  const tel: Array<{ who: string; type: string; meta: Record<string, unknown> }> = [];
  const ctrls: Record<string, MeetingInactivityController> = {};
  for (const id of ids) {
    ctrls[id] = new MeetingInactivityController({
      mode,
      selfId: id,
      now: clock.now,
      setTimer: () => 1,
      clearTimer: () => {},
      newId: () => `w${t}`,
      send: (e) => {
        sent.push({ from: id, e });
        for (const o of ids) if (o !== id) ctrls[o].receive(e);
      },
      onEject: () => { ejects[id] = (ejects[id] ?? 0) + 1; },
      onWarning: () => { warnings[id] = (warnings[id] ?? 0) + 1; },
      telemetry: (type, meta) => tel.push({ who: id, type, meta }),
    });
  }
  const ctx = (over: Partial<Parameters<MeetingInactivityController["update"]>[0]> = {}) => ({
    privateConnected: true, zoneId: "reuniao", participants: ids, screenShareActive: false, ...over,
  });
  const updateAll = (over = {}) => ids.forEach((i) => ctrls[i].update(ctx(over)));
  const tickAll = () => ids.forEach((i) => ctrls[i].tick());
  return { clock, sent, ejects, warnings, tel, ctrls, updateAll, tickAll, ctx };
}

describe("Meeting Inactivity Guard", () => {
  it("1. lobby nunca ativa", () => {
    const n = net(["a", "b"]);
    n.updateAll({ privateConnected: false, zoneId: null });
    n.clock.advance(IDLE_TIMEOUT_MS * 2); n.tickAll();
    expect(n.ctrls.a.getSnapshot().state).toBe("DISABLED");
    expect(n.sent).toHaveLength(0);
  });
  it("2. private com 1 pessoa não ativa", () => {
    const n = net(["a"]);
    n.updateAll();
    expect(n.ctrls.a.getSnapshot().state).toBe("DISABLED");
  });
  it("3. private com 2 pessoas ativa", () => {
    const n = net(["a", "b"]); n.updateAll();
    expect(n.ctrls.a.getSnapshot().state).toBe("ACTIVE");
  });
  it("4/5/6. 5 min geram um único warning do coordenador com deadline comum", () => {
    const n = net(["b", "a", "c"]); n.updateAll();
    n.clock.advance(IDLE_TIMEOUT_MS - 1); n.tickAll();
    expect(n.sent).toHaveLength(0);
    n.clock.advance(1); n.tickAll();
    const w = n.sent.filter((s) => s.e.type === "MEETING_IDLE_WARNING");
    expect(w).toHaveLength(1);
    expect(w[0].from).toBe("a");
    const dl = n.ctrls.a.getSnapshot().deadlineAt;
    expect(dl).toBe(n.clock.now() + WARNING_DURATION_MS);
    expect(n.ctrls.b.getSnapshot().deadlineAt).toBe(dl);
    expect(n.ctrls.c.getSnapshot().state).toBe("WARNING");
    expect(n.warnings).toEqual({ a: 1, b: 1, c: 1 });
  });
  const toWarning = (ids = ["a", "b"], mode: MeetingIdleMode = "enforce") => {
    const n = net(ids, mode); n.updateAll();
    n.clock.advance(IDLE_TIMEOUT_MS); n.tickAll();
    return n;
  };
  it("7. fala sustentada cancela", () => {
    const n = toWarning();
    n.ctrls.b.speaking("b", true); n.ctrls.a.speaking("b", true);
    n.clock.advance(700); n.tickAll();
    expect(n.ctrls.a.getSnapshot().state).toBe("ACTIVE");
    expect(n.ctrls.b.getSnapshot().state).toBe("ACTIVE");
    expect(n.tel.find((t) => t.type === "MEETING_IDLE_WARNING_CANCELLED")?.meta.reason).toBe("voice");
  });
  it("8. speaking curto não cancela", () => {
    const n = toWarning();
    n.ctrls.a.speaking("b", true); n.clock.advance(300); n.ctrls.a.speaking("b", false); n.tickAll();
    expect(n.ctrls.a.getSnapshot().state).toBe("WARNING");
  });
  it("9. movimento cancela globalmente", () => {
    const n = toWarning();
    n.ctrls.b.movement("b");
    expect(n.ctrls.a.getSnapshot().state).toBe("ACTIVE");
    expect(n.sent.some((s) => s.e.type === "MEETING_IDLE_CANCEL" && s.from === "a" && !("request" in s.e && s.e.request))).toBe(true);
  });
  it("10/11. screen share impede warning; fim reinicia 5 min", () => {
    const n = net(["a", "b"]); n.updateAll({ screenShareActive: true });
    n.clock.advance(IDLE_TIMEOUT_MS * 3); n.tickAll();
    expect(n.sent).toHaveLength(0);
    n.updateAll({ screenShareActive: false });
    n.clock.advance(IDLE_TIMEOUT_MS - 1); n.tickAll();
    expect(n.sent).toHaveLength(0);
    n.clock.advance(1); n.tickAll();
    expect(n.ctrls.a.getSnapshot().state).toBe("WARNING");
  });
  it("12. Continuar reunião (não-coordenador) cancela para todos", () => {
    const n = toWarning();
    n.ctrls.b.continueClicked();
    expect(n.ctrls.a.getSnapshot().state).toBe("ACTIVE");
    expect(n.ctrls.b.getSnapshot().state).toBe("ACTIVE");
  });
  it("13/14. entrada e saída de participante resetam", () => {
    const n = toWarning(["a", "b", "c"]);
    ["a", "b"].forEach((i) => n.ctrls[i].update(n.ctx({ participants: ["a", "b"] })));
    expect(n.ctrls.a.getSnapshot().state).toBe("ACTIVE");
    expect(n.ctrls.a.getSnapshot().lastActivityAt).toBe(n.clock.now());
    n.clock.advance(60_000);
    n.ctrls.a.update(n.ctx({ participants: ["a", "b", "d"] }));
    expect(n.ctrls.a.getSnapshot().lastActivityAt).toBe(n.clock.now());
  });
  it("15. coordenador determinístico", () => {
    expect(electCoordinator(["z", "m", "b"])).toBe("b");
    expect(electCoordinator(["b", "z", "m"])).toBe("b");
  });
  it("16. warn mode nunca ejeta", () => {
    const n = toWarning(["a", "b"], "warn");
    n.clock.advance(WARNING_DURATION_MS); n.tickAll();
    expect(n.ejects).toEqual({});
    expect(n.tel.some((t) => t.type === "MEETING_IDLE_WOULD_EJECT")).toBe(true);
    expect(n.ctrls.b.getSnapshot().state).toBe("ACTIVE");
  });
  it("17/18. enforce emite EJECT e cada cliente ejeta só a si mesmo uma vez", () => {
    const n = toWarning(["a", "b", "c"]);
    n.clock.advance(WARNING_DURATION_MS); n.tickAll();
    expect(n.sent.filter((s) => s.e.type === "MEETING_IDLE_EJECT")).toHaveLength(1);
    expect(n.ejects).toEqual({ a: 1, b: 1, c: 1 });
  });
  it("28. aba em background: deadline absoluto (timer atrasado não adia)", () => {
    const n = toWarning();
    n.clock.advance(WARNING_DURATION_MS * 10); // timer atrasado
    n.ctrls.a.tick();
    expect(n.ejects.a).toBe(1);
  });
  it("não-coordenador nunca inicia warning", () => {
    const n = net(["a", "b"]);
    n.ctrls.b.update(n.ctx());
    n.clock.advance(IDLE_TIMEOUT_MS * 2); n.ctrls.b.tick();
    expect(n.ctrls.b.getSnapshot().state).toBe("ACTIVE");
  });
  it("30. flag off preserva comportamento", () => {
    expect(parseMeetingIdleMode(undefined)).toBe("off");
    expect(parseMeetingIdleMode("x")).toBe("off");
    const n = net(["a", "b"], "off"); n.updateAll();
    n.clock.advance(IDLE_TIMEOUT_MS * 2); n.tickAll();
    expect(n.ctrls.a.getSnapshot().state).toBe("DISABLED");
    expect(n.sent).toHaveLength(0);
  });
});

describe("Return position", () => {
  it("19. usa lastSafeNonPrivatePosition congelada ao entrar", () => {
    const r = new MeetingReturnPosition();
    r.observe({ x: 0.1, y: 0.1 }, false);
    r.observe({ x: 0.2, y: 0.2 }, false);
    r.observe({ x: 0.5, y: 0.5 }, true);
    r.observe({ x: 0.6, y: 0.6 }, true);
    expect(r.resolve({ x: 0, y: 0 })).toEqual({ point: { x: 0.2, y: 0.2 }, fallback: false });
  });
  it("20. sem posição segura usa spawn", () => {
    const r = new MeetingReturnPosition();
    r.observe({ x: 0.5, y: 0.5 }, true);
    expect(r.resolve({ x: 0.3, y: 0.4 })).toEqual({ point: { x: 0.3, y: 0.4 }, fallback: true });
  });
});

describe("MeetingTracker idle_timeout", () => {
  const priv = { kind: "PRIVATE_ROOM" as const, zoneId: "reuniao" };
  it("24/25. endNow fecha sem grace; voltar cria nova reunião", async () => {
    let n = 0;
    const leave = vi.fn(async () => {});
    const t = new MeetingTrackerV2({ join: async () => `m${++n}`, leave });
    t.observe({ status: "CONNECTED", connected: priv, remoteCount: 1 });
    await t.whenIdle();
    expect(t.getMeetingId()).toBe("m1");
    t.endNow();
    await t.whenIdle();
    expect(leave).toHaveBeenCalledWith("m1");
    // Ainda na mesma Room: não rejunta.
    t.observe({ status: "CONNECTED", connected: priv, remoteCount: 1 });
    await t.whenIdle();
    expect(t.getMeetingId()).toBeNull();
    // Saiu e voltou: nova reunião.
    t.observe({ status: "DISCONNECTED", connected: null });
    t.observe({ status: "CONNECTED", connected: priv, remoteCount: 1 });
    await t.whenIdle();
    expect(t.getMeetingId()).toBe("m2");
    await t.dispose();
  });
});

describe("isolamento (estático)", () => {
  const src = (f: string) => readFileSync(resolve(__dirname, "..", f), "utf8");
  it("23. guard nunca chama connect/disconnect", () => {
    for (const f of ["meeting-inactivity-controller.ts", "useMeetingIdleGuard.ts"]) {
      expect(src(f)).not.toMatch(/\.connect\(|\.disconnect\(|RoomManager/);
    }
  });
  it("29. reutiliza OfficeNotificationService", () => {
    expect(src("useMeetingIdleGuard.ts")).toMatch(/OfficeNotificationService/);
    expect(src("useMeetingIdleGuard.ts")).not.toMatch(/new Notification\(/);
  });
});
