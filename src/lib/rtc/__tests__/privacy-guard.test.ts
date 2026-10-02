import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { PrivacyGuard } from "../privacy-guard";

function setup(init: { mic?: boolean; cam?: boolean; screen?: boolean } = {}) {
  const st = { mic: !!init.mic, cam: !!init.cam, screen: !!init.screen, roomConnected: true, egress: true };
  const ops: string[] = [];
  const events: string[] = [];
  let pending: { fn: () => void; at: number } | null = null;
  let now = 0;
  const timers = {
    setTimeout: (fn: () => void, ms: number) => ((pending = { fn, at: now + ms }), pending),
    clearTimeout: () => void (pending = null),
  };
  const advance = (ms: number) => {
    now += ms;
    if (pending && pending.at <= now) { const p = pending; pending = null; p.fn(); }
  };
  // APIs de microfone expostas propositalmente: o guard nunca deve chamá-las.
  const media = {
    isMicOn: vi.fn(() => st.mic),
    setMic: vi.fn(async (on: boolean) => { ops.push(`mic:${on}`); st.mic = on; }),
    isScreenSharing: vi.fn(() => st.screen),
    isCamOn: () => st.cam,
    setCam: vi.fn(async (on: boolean) => { ops.push(`cam:${on}`); st.cam = on; }),
  };
  const g = new PrivacyGuard(media, { timers, telemetry: { record: (t) => void events.push(t) } });
  return { g, st, ops, events, advance, media };
}
const flush = () => new Promise((r) => setTimeout(r, 0));
const hide30 = async (t: ReturnType<typeof setup>) => { t.g.setVisibility(true); t.advance(30_000); await flush(); };

describe("PrivacyGuard (somente câmera)", () => {
  it("1: hidden <30s não altera câmera", () => {
    const t = setup({ cam: true });
    t.g.setVisibility(true); t.advance(29_000); t.g.setVisibility(false);
    expect(t.ops).toEqual([]);
    expect(t.events).toContain("PRIVACY_GUARD_CANCELLED");
  });
  it("2: hidden ≥30s desliga câmera ON", async () => {
    const t = setup({ cam: true }); await hide30(t);
    expect(t.ops).toEqual(["cam:false"]);
    expect(t.events).toContain("PRIVACY_GUARD_SUSPENDED");
  });
  it("3: câmera já OFF não faz operação nem aviso", async () => {
    const t = setup({ mic: true }); await hide30(t);
    expect(t.ops).toEqual([]);
    expect(t.g.getSnapshot().suspended).toBe(false);
  });
  it("4-6: mic ON/OFF permanece; nenhuma API de mic é chamada", async () => {
    for (const mic of [true, false]) {
      const t = setup({ mic, cam: true }); await hide30(t);
      t.g.setVisibility(false); await t.g.restore();
      expect(t.st.mic).toBe(mic);
      expect(t.media.setMic).not.toHaveBeenCalled();
      expect(t.media.isMicOn).not.toHaveBeenCalled();
    }
  });
  it("7-8: screen share + mic continuam enquanto a câmera é desligada", async () => {
    const t = setup({ mic: true, cam: true, screen: true }); await hide30(t);
    expect(t.ops).toEqual(["cam:false"]);
    expect(t.st.screen).toBe(true);
    expect(t.st.mic).toBe(true);
    expect(t.events).not.toContain("PRIVACY_GUARD_SKIPPED_SCREEN_SHARE");
  });
  it("9: voltar não religa câmera; mostra aviso", async () => {
    const t = setup({ cam: true }); await hide30(t);
    t.g.setVisibility(false);
    expect(t.st.cam).toBe(false);
    expect(t.g.getSnapshot().promptVisible).toBe(true);
  });
  it("10: Reativar câmera religa somente a câmera", async () => {
    const t = setup({ cam: true }); await hide30(t);
    t.g.setVisibility(false); await t.g.restore();
    expect(t.ops).toEqual(["cam:false", "cam:true"]);
    expect(t.events).toContain("PRIVACY_GUARD_RESTORED");
  });
  it("11: Manter desligada mantém câmera OFF", async () => {
    const t = setup({ cam: true }); await hide30(t);
    t.g.setVisibility(false); t.g.keepOff();
    expect(t.st.cam).toBe(false);
    expect(t.g.getSnapshot().promptVisible).toBe(false);
    expect(t.events).toContain("PRIVACY_GUARD_KEEP_OFF");
  });
  it("12-15: troca de Room/mídia não religa câmera; Room/Egress intactos; sem meeting_leave", async () => {
    const t = setup({ cam: true }); await hide30(t);
    t.g.onLocalMediaChange(); t.g.setVisibility(false); t.g.onLocalMediaChange();
    expect(t.st.cam).toBe(false);
    expect(t.st.roomConnected).toBe(true);
    expect(t.st.egress).toBe(true);
    const src = readFileSync("src/lib/rtc/privacy-guard.ts", "utf8");
    expect(src).not.toMatch(/meeting_leave|RoomManager|egress\(|setMicrophoneEnabled|LocalAudioTrack/);
  });
  it("runtime passa apenas câmera ao guard", () => {
    const rt = readFileSync("src/lib/rtc/rtc-v2-runtime.ts", "utf8");
    const block = rt.slice(rt.indexOf("new PrivacyGuard("), rt.indexOf("new PrivacyGuard(") + 400);
    expect(block).not.toMatch(/setMic|isMicOn|isScreenSharing/);
  });
  it("16-17: texto exato Reativar câmera e nunca 'Reativar o leão'", () => {
    const scene = readFileSync("src/components/office/OfficeScene.tsx", "utf8");
    expect(scene).toMatch(/>\s*Reativar câmera\s*</);
    expect(scene).toMatch(/>\s*Manter desligada\s*</);
    expect(scene).toContain("Câmera pausada por privacidade");
    expect(scene).not.toMatch(/Reativar o leão|Dispositivos pausados por privacidade/);
  });
});
