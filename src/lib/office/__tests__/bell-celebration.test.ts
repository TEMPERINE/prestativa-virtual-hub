import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  buildCelebration, canSubmitCelebration, createCelebrationCenter, parseCelebration, sanitizeCelebrationMessage,
  CELEBRATION_COOLDOWN_MS, CELEBRATION_MAX_LEN, CELEBRATION_PENDING_TTL_MS, CELEBRATION_TOAST_MS,
} from "../bell-celebration";

function setup(ws = "ws1") {
  let t = 1000; const state = { bg: false };
  const show = vi.fn();
  const c = createCelebrationCenter({ workspaceId: () => ws, isBackground: () => state.bg, show, now: () => t });
  const ev = (id = "c1", w = ws) => ({ celebrationId: id, workspaceId: w, senderId: "u1", reason: "elogio", message: "Parabéns, Fram!", at: t });
  return { c, show, state, ev, tick: (ms: number) => { t += ms; } };
}

describe("bell celebration", () => {
  it("mensagem vazia não pode ser enviada", () => {
    expect(canSubmitCelebration("   ")).toBe(false);
    expect(buildCelebration({ workspaceId: "w", senderId: "u", message: " ", at: 0 })).toBeNull();
  });
  it("sanitiza HTML e respeita limite", () => {
    expect(sanitizeCelebrationMessage("<b>oi</b> <script>x</script>")).toBe("oi x");
    expect(sanitizeCelebrationMessage("a".repeat(500))).toHaveLength(CELEBRATION_MAX_LEN);
  });
  it("sender vem do id autenticado; senderName do payload é descartado", () => {
    const p = parseCelebration({ celebrationId: "x", workspaceId: "w", senderId: "u1", senderName: "Hacker", message: "oi" });
    expect(p).not.toHaveProperty("senderName");
    expect(p?.senderId).toBe("u1");
  });
  it("mesmo workspace recebe; outro workspace não", () => {
    const s = setup();
    expect(s.c.receive(s.ev("a"))).toBe("shown");
    expect(s.c.receive(s.ev("b", "ws2"))).toBe("ignored");
    expect(s.show).toHaveBeenCalledTimes(1);
  });
  it("evento duplicado não repete", () => {
    const s = setup();
    s.c.receive(s.ev("a")); expect(s.c.receive(s.ev("a"))).toBe("duplicate");
    expect(s.show).toHaveBeenCalledTimes(1);
  });
  it("fora de foco guarda pendente e mostra comemoração normal ao voltar", () => {
    const s = setup(); s.state.bg = true;
    expect(s.c.receive(s.ev("a"))).toBe("pending"); expect(s.show).not.toHaveBeenCalled();
    s.state.bg = false; expect(s.c.onForeground()).toBe(true);
    expect(s.show.mock.calls[0][0]).toMatchObject({ missed: false, celebrationId: "a" });
    expect(s.c.onForeground()).toBe(false);
  });
  it("pendente não expira antes de ficar realmente visível", () => {
    const s = setup(); s.state.bg = true; s.c.receive(s.ev("a"));
    s.tick(CELEBRATION_PENDING_TTL_MS + 1); expect(s.c.onForeground()).toBe(false);
    s.state.bg = false;
    expect(s.c.onForeground()).toBe(true);
    expect(s.show.mock.calls[0][0]).toMatchObject({ missed: false });
  });
  it("envio local que termina sem foco também aguarda retorno", () => {
    const s = setup(); s.state.bg = true;
    const e = buildCelebration({ workspaceId: "ws1", senderId: "u1", message: "oi", at: 0 });
    if (!e) throw new Error("Expected valid celebration");
    expect(s.c.trySend("u1", e)).toBe(true);
    expect(s.show).not.toHaveBeenCalled();
    s.state.bg = false; expect(s.c.onForeground()).toBe(true);
  });
  it("cooldown evita spam", () => {
    const s = setup(); const e = buildCelebration({ workspaceId: "ws1", senderId: "u1", message: "oi", at: 0 })!;
    expect(s.c.trySend("u1", e)).toBe(true);
    expect(s.c.trySend("u1", { ...e, celebrationId: "z" })).toBe(false);
    expect(s.c.cooldownRemaining("u1")).toBeGreaterThan(0);
    s.tick(CELEBRATION_COOLDOWN_MS); expect(s.c.cooldownRemaining("u1")).toBe(0);
  });
  it("eco do próprio envio não repete", () => {
    const s = setup(); const e = buildCelebration({ workspaceId: "ws1", senderId: "u1", message: "oi", at: 0 })!;
    s.c.trySend("u1", e); expect(s.c.receive(e)).toBe("duplicate");
  });
  it("toast some sozinho em ~12 s", () => { expect(CELEBRATION_TOAST_MS).toBe(12_000); });
  it("som vem só do prop_tick (uma vez); celebração não toca áudio; sem RTC/Presence", () => {
    const src = readFileSync("src/lib/office/bell-celebration.ts", "utf8");
    expect(src).not.toMatch(/new Audio|livekit|presence/i);
    const layer = readFileSync("src/components/office/PropsLayer.tsx", "utf8");
    expect(layer).not.toMatch(/livekit|RoomManager|office-presence/i);
    expect(layer).toMatch(/onRingOnly=\{\(\) => \{ setBellMenuFor\(null\); triggerInteract\(prop\); \}\}/);
    expect(layer).toMatch(/CELEBRATION_PROP_DEFS\.has\(prop\.defId\)\) \{ setBellMenuFor/);
  });
});
