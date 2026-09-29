import { describe, it, expect } from "vitest";
import { MicLevelMeter } from "../mic-level-meter";
import { LocalMedia } from "../local-media";

function setup(opts: { fail?: boolean } = {}) {
  const frames: Array<() => void> = [];
  const levels: number[] = [];
  const analysers: Array<{ track: unknown; vol: number; cleaned: boolean }> = [];
  const m = new MicLevelMeter({
    createAnalyser: (track) => {
      if (opts.fail) throw new Error("no AudioContext");
      const a = { track, vol: 0, cleaned: false };
      analysers.push(a);
      return { calculateVolume: () => a.vol, cleanup: () => void (a.cleaned = true) };
    },
    onLevel: (l) => levels.push(l),
    raf: (fn) => frames.push(fn),
    caf: () => void frames.splice(0),
  });
  const tick = () => frames.splice(0).forEach((f) => f());
  return { m, frames, levels, analysers, tick };
}

describe("MicLevelMeter", () => {
  it("1. mic OFF mostra nível zero sem analyser", () => {
    const s = setup();
    s.m.setTrack(null, null);
    expect(s.levels).toEqual([0]);
    expect(s.analysers.length).toBe(0);
  });
  it("2/3. mic ON usa a track atual e o volume altera o indicador", () => {
    const s = setup();
    const t = {};
    s.m.setTrack(t, "a");
    expect(s.analysers[0].track).toBe(t);
    s.analysers[0].vol = 0.3;
    s.tick();
    expect(s.levels.at(-1)).toBe(0.3);
  });
  it("4/5. troca de track/device libera analyser antigo e liga no novo", () => {
    const s = setup();
    const t = {};
    s.m.setTrack(t, "mst1");
    s.m.setTrack(t, "mst1"); // idempotente
    expect(s.analysers.length).toBe(1);
    s.m.setTrack(t, "mst2"); // restartTrack: mesma LocalAudioTrack, nova MST
    expect(s.analysers[0].cleaned).toBe(true);
    expect(s.analysers.length).toBe(2);
    s.m.setTrack(null, null);
    expect(s.analysers[1].cleaned).toBe(true);
    expect(s.levels.at(-1)).toBe(0);
  });
  it("6. dispose cancela frame e faz cleanup", () => {
    const s = setup();
    s.m.setTrack({}, "a");
    s.m.dispose();
    expect(s.analysers[0].cleaned).toBe(true);
    expect(s.frames.length).toBe(0);
    s.m.setTrack({}, "b");
    expect(s.analysers.length).toBe(1);
  });
  it("7. falha do analyser não lança", () => {
    const s = setup({ fail: true });
    expect(() => s.m.setTrack({}, "a")).not.toThrow();
    expect(s.levels.at(-1)).toBe(0);
  });
  it("8. medidor nunca altera estado do mic", async () => {
    const lm = new LocalMedia({
      createMicrophoneTrack: async () => ({
        source: "microphone",
        stop() {},
        onEnded: () => () => {},
      }),
      createCameraTrack: async () => {
        throw new Error();
      },
      createScreenTracks: async () => [],
    });
    await lm.setMicrophoneEnabled(true);
    const before = JSON.stringify(lm.getSnapshot());
    const s = setup();
    s.m.setTrack(lm.getTrack("microphone"), "a");
    s.analysers[0].vol = 0;
    for (let i = 0; i < 5; i++) s.tick();
    s.m.dispose();
    expect(JSON.stringify(lm.getSnapshot())).toBe(before);
  });
});
