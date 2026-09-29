/** Etapa 14A — diagnóstico de áudio: só observa, nunca controla. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AudioDiagnostics,
  AUDIO_STATS_INTERVAL_MS,
  AUDIO_SWAP_CHECK_MS,
} from "../rtc-audio-diagnostics";
import { LocalMedia, type CaptureAdapter, type LocalTrackLike } from "../local-media";
import type { RtcTelemetryEventType, TelemetryFields } from "../rtc-telemetry-types";

class FakeMst extends EventTarget {
  readyState = "live";
  enabled = true;
  muted = false;
  constructor(public id: string) {
    super();
  }
  fire(e: string) {
    this.dispatchEvent(new Event(e));
  }
}

class FakeRaw {
  handlers = new Map<string, Set<(...a: unknown[]) => void>>();
  state = "connected";
  remoteParticipants = new Map<string, unknown>();
  unpublish = vi.fn();
  localParticipant: Record<string, unknown> = {
    identity: "me",
    audioTrackPublications: new Map<string, unknown>(),
    unpublishTrack: this.unpublish,
  };
  on(e: string, fn: (...a: unknown[]) => void) {
    if (!this.handlers.has(e)) this.handlers.set(e, new Set());
    this.handlers.get(e)!.add(fn);
  }
  off(e: string, fn: (...a: unknown[]) => void) {
    this.handlers.get(e)?.delete(fn);
  }
  fire(e: string, ...a: unknown[]) {
    for (const fn of [...(this.handlers.get(e) ?? [])]) fn(...a);
  }
  count() {
    let n = 0;
    for (const s of this.handlers.values()) n += s.size;
    return n;
  }
}

function setup(opts: { throwingSink?: boolean } = {}) {
  const events: Array<{ type: RtcTelemetryEventType; f: TelemetryFields }> = [];
  let micTrack: { mediaStreamTrack: FakeMst; lk?: unknown } | null = null;
  const intent = { v: true };
  const diag = new AudioDiagnostics({
    sink: {
      record: (type, f) => {
        if (opts.throwingSink) throw new Error("sink down");
        events.push({ type, f: f ?? {} });
      },
    },
    getMicIntent: () => intent.v,
    getMicTrack: () => micTrack as never,
    getRoomName: () => "ws:reuniao",
  });
  const raw = new FakeRaw();
  return {
    diag,
    raw,
    events,
    intent,
    setMic: (t: typeof micTrack) => {
      micTrack = t;
      diag.onLocalMediaChange();
    },
    of: (t: RtcTelemetryEventType) => events.filter((e) => e.type === t),
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("AudioDiagnostics", () => {
  it("1. entrada de terceiro participante não chama mute/unpublish da track local", () => {
    const h = setup();
    const mst = new FakeMst("mic-aaaaaaaa");
    const mute = vi.fn();
    const track = { mediaStreamTrack: mst, mute, sender: { track: mst } };
    (h.raw.localParticipant.audioTrackPublications as Map<string, unknown>).set("p1", {
      trackSid: "TR_mic1",
      source: "microphone",
      isMuted: false,
      track,
    });
    h.setMic({ mediaStreamTrack: mst });
    h.diag.attachRoom(h.raw, { kind: "PRIVATE_ROOM", zoneId: "reuniao" });
    h.raw.fire("participantConnected", { identity: "tracy-0000-1111" });
    expect(mute).not.toHaveBeenCalled();
    expect(h.raw.unpublish).not.toHaveBeenCalled();
    const snap = h
      .of("AUDIO_SNAPSHOT")
      .find((e) => e.f.metadata?.reason === "participant_connected");
    expect(snap?.f.metadata?.identity).toBe("tracy-00");
    expect(String(snap?.f.metadata?.snapshot)).toContain("me:TR_mic1:m0:live");
    h.diag.dispose();
  });

  it("2-4. ended/mute/unmute da track local são observados", () => {
    const h = setup();
    const mst = new FakeMst("mic-1");
    h.setMic({ mediaStreamTrack: mst });
    mst.muted = true;
    mst.fire("mute");
    mst.muted = false;
    mst.fire("unmute");
    mst.readyState = "ended";
    mst.fire("ended");
    const evs = h.of("AUDIO_LOCAL_TRACK").map((e) => e.f.metadata);
    expect(evs.map((m) => m?.event)).toEqual(["mute", "unmute", "ended"]);
    expect(evs[0]).toMatchObject({ muted: true, mstId: "mic-1", micIntent: true });
    expect(evs[2]).toMatchObject({ readyState: "ended" });
    h.diag.dispose();
  });

  it("5-6. subscribed/unsubscribed remoto registram participante + track", () => {
    const h = setup();
    h.diag.attachRoom(h.raw, { kind: "PRIVATE_ROOM", zoneId: "reuniao" });
    const pub = { trackSid: "TR_dani", source: "microphone", isSubscribed: true, isMuted: false };
    const track = { source: "microphone", kind: "audio", mediaStreamTrack: new FakeMst("rx-1") };
    h.raw.fire("trackSubscribed", track, pub, { identity: "dani-1234-xx" });
    pub.isSubscribed = false;
    h.raw.fire("trackUnsubscribed", track, pub, { identity: "dani-1234-xx" });
    const evs = h.of("AUDIO_REMOTE_TRACK").map((e) => e.f.metadata);
    expect(evs).toHaveLength(2);
    expect(evs[0]).toMatchObject({
      event: "subscribed",
      identity: "dani-123",
      publicationSid: "TR_dani",
      subscribed: true,
    });
    expect(evs[1]).toMatchObject({
      event: "unsubscribed",
      identity: "dani-123",
      subscribed: false,
    });
    h.diag.dispose();
  });

  it("7. toggle OFF → ON registra track anterior e nova + checagem de publicação", () => {
    const h = setup();
    h.diag.attachRoom(h.raw, { kind: "PRIVATE_ROOM", zoneId: "reuniao" });
    h.setMic({ mediaStreamTrack: new FakeMst("old-1111") });
    h.setMic(null);
    const next = new FakeMst("new-2222");
    h.setMic({ mediaStreamTrack: next });
    const swaps = h.of("AUDIO_MIC_SWAP").map((e) => e.f.metadata);
    expect(swaps.at(-1)).toMatchObject({
      reason: "mic_on",
      prevMstId: "old-1111",
      mstId: "new-2222",
    });
    (h.raw.localParticipant.audioTrackPublications as Map<string, unknown>).set("p", {
      trackSid: "TR_new",
      source: "microphone",
      track: { mediaStreamTrack: next, sender: { track: next } },
    });
    vi.advanceTimersByTime(AUDIO_SWAP_CHECK_MS);
    expect(h.of("AUDIO_MIC_SWAP").at(-1)?.f.metadata).toMatchObject({
      status: "check",
      publishResult: "published_new_track",
      senderMatchesLocal: true,
      micPublications: 1,
    });
    h.diag.dispose();
  });

  it("8. troca de dispositivo registra device e tracks anterior/nova", () => {
    const h = setup();
    h.setMic({ mediaStreamTrack: new FakeMst("old-a") });
    h.diag.noteDeviceChange("deviceAAAAAAAAAAAA", "deviceBBBBBBBBBBBB");
    h.setMic(null);
    h.setMic({ mediaStreamTrack: new FakeMst("new-b") });
    expect(h.of("AUDIO_MIC_SWAP").at(-1)?.f.metadata).toMatchObject({
      reason: "device_change",
      deviceFrom: "deviceAA",
      deviceTo: "deviceBB",
      prevMstId: "old-a",
      mstId: "new-b",
    });
    h.diag.dispose();
  });

  it("9. instrumentação não altera LocalMedia", async () => {
    const mk = (): LocalTrackLike & { mediaStreamTrack: FakeMst } => ({
      source: "microphone",
      mediaStreamTrack: new FakeMst("m"),
      stop: vi.fn(),
      onEnded: () => () => {},
    });
    const adapter: CaptureAdapter = {
      createMicrophoneTrack: async () => mk(),
      createCameraTrack: async () => mk(),
      createScreenTracks: async () => [],
    };
    const room = { publishTrack: vi.fn(async () => {}), unpublishTrack: vi.fn(async () => {}) };
    const run = async (withDiag: boolean) => {
      const lm = new LocalMedia(adapter);
      const diag = withDiag
        ? new AudioDiagnostics({
            getMicIntent: () => lm.getSnapshot().microphone.intent,
            getMicTrack: () => lm.getTrack("microphone") as never,
          })
        : null;
      lm.subscribe(() => diag?.onLocalMediaChange());
      await lm.attachRoom(room);
      await lm.setMicrophoneEnabled(true);
      const s = lm.getSnapshot();
      diag?.dispose();
      await lm.dispose();
      return { intent: s.microphone.intent, status: s.microphone.status };
    };
    room.publishTrack.mockClear();
    const a = await run(false);
    const callsA = room.publishTrack.mock.calls.length;
    room.publishTrack.mockClear();
    const b = await run(true);
    expect(b).toEqual(a);
    expect(room.publishTrack.mock.calls.length).toBe(callsA);
  });

  it("10. falha da telemetria não altera RTC nem lança", () => {
    const h = setup({ throwingSink: true });
    const mst = new FakeMst("x");
    expect(() => {
      h.setMic({ mediaStreamTrack: mst });
      h.diag.attachRoom(h.raw, { kind: "PRIVATE_ROOM", zoneId: "r" });
      h.raw.fire("participantConnected", { identity: "u" });
      mst.fire("mute");
    }).not.toThrow();
    h.diag.dispose();
  });

  it("11. stats são coletados só por leitura (sem replaceTrack/setParameters)", async () => {
    const h = setup();
    const mst = new FakeMst("tx-11111");
    const sender = {
      track: mst,
      replaceTrack: vi.fn(),
      setParameters: vi.fn(),
      getStats: vi.fn(async () => {
        const m = new Map<string, Record<string, unknown>>([
          [
            "o",
            {
              type: "outbound-rtp",
              kind: "audio",
              bytesSent: 1000,
              packetsSent: 50,
              mediaSourceId: "ms1",
            },
          ],
          [
            "s",
            { type: "media-source", kind: "audio", audioLevel: 0.2, trackIdentifier: "tx-11111" },
          ],
        ]);
        return m as unknown as RTCStatsReport;
      }),
    };
    (h.raw.localParticipant.audioTrackPublications as Map<string, unknown>).set("p", {
      trackSid: "TR_me",
      source: "microphone",
      track: { mediaStreamTrack: mst, sender },
    });
    const rxStats = vi.fn(
      async () =>
        new Map([
          [
            "i",
            {
              type: "inbound-rtp",
              kind: "audio",
              bytesReceived: 900,
              packetsReceived: 45,
              packetsLost: 0,
            },
          ],
        ]) as unknown as RTCStatsReport,
    );
    h.raw.remoteParticipants.set("dani", {
      identity: "dani-abcdef",
      audioTrackPublications: new Map([
        [
          "r",
          {
            trackSid: "TR_d",
            source: "microphone",
            isSubscribed: true,
            track: { getRTCStatsReport: rxStats, mediaStreamTrack: new FakeMst("rx") },
          },
        ],
      ]),
    });
    h.setMic({ mediaStreamTrack: mst });
    h.diag.attachRoom(h.raw, { kind: "PRIVATE_ROOM", zoneId: "reuniao" });
    await vi.advanceTimersByTimeAsync(AUDIO_STATS_INTERVAL_MS);
    expect(h.of("AUDIO_TX_STATS")[0]?.f.metadata).toMatchObject({
      bytesSent: 1000,
      packetsSent: 50,
      audioLevel: 0.2,
      senderMatchesLocal: true,
      micPublications: 1,
    });
    expect(h.of("AUDIO_RX_STATS")[0]?.f.metadata).toMatchObject({
      identity: "dani-abc",
      bytesReceived: 900,
      packetsReceived: 45,
      packetsLost: 0,
    });
    expect(sender.replaceTrack).not.toHaveBeenCalled();
    expect(sender.setParameters).not.toHaveBeenCalled();
    h.diag.dispose();
  });

  it("12. dispose remove listeners, timers e polling", async () => {
    const h = setup();
    const mst = new FakeMst("m");
    const rm = vi.spyOn(mst, "removeEventListener");
    h.setMic({ mediaStreamTrack: mst });
    h.diag.attachRoom(h.raw, { kind: "PRIVATE_ROOM", zoneId: "reuniao" });
    h.setMic({ mediaStreamTrack: new FakeMst("m2") }); // agenda swap check
    expect(h.raw.count()).toBeGreaterThan(0);
    h.diag.dispose();
    expect(h.raw.count()).toBe(0);
    expect(rm).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    const n = h.events.length;
    await vi.advanceTimersByTimeAsync(AUDIO_STATS_INTERVAL_MS * 3);
    expect(h.events.length).toBe(n);
  });
});
