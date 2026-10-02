import { describe, expect, it, vi } from "vitest";
import { PrivacyGuard } from "../privacy-guard";

function setup(init: { mic?: boolean; cam?: boolean; screen?: boolean } = {}) {
  const st = { mic: !!init.mic, cam: !!init.cam, screen: !!init.screen };
  const ops: string[] = [];
  const pubs = { mic: st.mic ? 1 : 0 };
  const events: string[] = [];
  let pending: { fn: () => void; at: number } | null = null;
  let now = 0;
  const timers = {
    setTimeout: (fn: () => void, ms: number) => ((pending = { fn, at: now + ms }), pending),
    clearTimeout: () => void (pending = null),
  };
  const advance = (ms: number) => {
    now += ms;
    if (pending && pending.at <= now) {
      const p = pending;
      pending = null;
      p.fn();
    }
  };
  const media = {
    isMicOn: () => st.mic,
    isCamOn: () => st.cam,
    isScreenSharing: () => st.screen,
    setMic: vi.fn(async (on: boolean) => {
      ops.push(`mic:${on}`);
      st.mic = on;
    }),
    setCam: vi.fn(async (on: boolean) => {
      ops.push(`cam:${on}`);
      st.cam = on;
    }),
  };
  const g = new PrivacyGuard(media, {
    timers,
    telemetry: { record: (t) => void events.push(t) },
  });
  return { g, st, ops, events, advance, pubs, hasTimer: () => pending !== null };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("PrivacyGuard", () => {
  it("1-2: hidden 10s / 29s não altera mídia", () => {
    const t = setup({ mic: true, cam: true });
    t.g.setVisibility(true);
    t.advance(10_000);
    t.advance(19_000);
    expect(t.ops).toEqual([]);
  });

  it("3,5: hidden 30s suspende mic e câmera", async () => {
    const t = setup({ mic: true, cam: true });
    t.g.setVisibility(true);
    t.advance(30_000);
    await flush();
    expect(t.ops.sort()).toEqual(["cam:false", "mic:false"]);
    expect(t.events).toContain("PRIVACY_GUARD_SUSPENDED");
  });

  it("4: visible antes de 30s cancela, sem aviso", () => {
    const t = setup({ mic: true });
    t.g.setVisibility(true);
    t.advance(20_000);
    t.g.setVisibility(false);
    t.advance(60_000);
    expect(t.ops).toEqual([]);
    expect(t.g.getSnapshot().promptVisible).toBe(false);
    expect(t.events).toEqual(["PRIVACY_GUARD_ARMED", "PRIVACY_GUARD_CANCELLED"]);
  });

  it("6: mic ON/cam OFF suspende só mic", async () => {
    const t = setup({ mic: true });
    t.g.setVisibility(true);
    t.advance(30_000);
    await flush();
    expect(t.ops).toEqual(["mic:false"]);
  });

  it("7: mic OFF/cam ON suspende só câmera", async () => {
    const t = setup({ cam: true });
    t.g.setVisibility(true);
    t.advance(30_000);
    await flush();
    expect(t.ops).toEqual(["cam:false"]);
  });

  it("8: ambos OFF → nenhuma operação nem aviso", async () => {
    const t = setup();
    t.g.setVisibility(true);
    t.advance(30_000);
    await flush();
    t.g.setVisibility(false);
    expect(t.ops).toEqual([]);
    expect(t.g.getSnapshot().suspended).toBe(false);
  });

  it("11-12: retorno não reativa; restaurar liga só o que estava ON", async () => {
    const t = setup({ mic: true });
    t.g.setVisibility(true);
    t.advance(30_000);
    await flush();
    t.g.setVisibility(false);
    expect(t.g.getSnapshot().promptVisible).toBe(true);
    expect(t.st.mic).toBe(false);
    await t.g.restore();
    expect(t.ops).toEqual(["mic:false", "mic:true"]);
    expect(t.st.cam).toBe(false);
    expect(t.g.getSnapshot().suspended).toBe(false);
    expect(t.events).toContain("PRIVACY_GUARD_RESTORED");
  });

  it("13: manter desligados não restaura nada", async () => {
    const t = setup({ mic: true, cam: true });
    t.g.setVisibility(true);
    t.advance(30_000);
    await flush();
    t.g.setVisibility(false);
    t.g.keepOff();
    await t.g.restore();
    expect(t.ops.filter((o) => o.endsWith("true"))).toEqual([]);
    expect(t.events).toContain("PRIVACY_GUARD_KEEP_OFF");
  });

  it("16: screen share ativo impede suspensão", async () => {
    const t = setup({ mic: true, screen: true });
    t.g.setVisibility(true);
    t.advance(30_000);
    await flush();
    expect(t.ops).toEqual([]);
    expect(t.events).toContain("PRIVACY_GUARD_SKIPPED_SCREEN_SHARE");
  });

  it("17: fim do screen share enquanto hidden suspende imediatamente", async () => {
    const t = setup({ mic: true, screen: true });
    t.g.setVisibility(true);
    t.advance(30_000);
    t.st.screen = false;
    t.g.onLocalMediaChange();
    await flush();
    expect(t.ops).toEqual(["mic:false"]);
    expect(t.hasTimer()).toBe(false);
  });

  it("escolha manual após retorno vira nova intenção", async () => {
    const t = setup({ mic: true });
    t.g.setVisibility(true);
    t.advance(30_000);
    await flush();
    t.g.setVisibility(false);
    t.g.noteManualToggle();
    expect(t.g.getSnapshot().suspended).toBe(false);
  });

  it("20: dispose limpa timer e estado", () => {
    const t = setup({ mic: true });
    t.g.setVisibility(true);
    t.g.dispose();
    expect(t.hasTimer()).toBe(false);
    t.advance(60_000);
    expect(t.ops).toEqual([]);
  });
});
