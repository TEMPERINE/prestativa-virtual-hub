/**
 * Privacy Fase 2 — Mic OFF = captura real parada (stopOnMute), ON = reaquisição
 * na MESMA track/publicação. Simula a semântica do LocalAudioTrack do LiveKit.
 */
import { describe, it, expect } from "vitest";
import {
  LocalMedia,
  type CaptureAdapter,
  type LocalTrackLike,
  type PublishTargetLike,
} from "../local-media";

let mstSeq = 0;
class FakeMST {
  id = `mst-${++mstSeq}`;
  readyState: "live" | "ended" = "live";
  listeners = new Set<() => void>();
  constructor(public deviceId: string) {}
  stop() {
    this.readyState = "ended"; // como no browser: stop() NÃO dispara "ended"
  }
  hardwareLoss() {
    this.readyState = "ended";
    for (const l of [...this.listeners]) l();
  }
}

/** Imita LocalAudioTrack (stopOnMute=true) + wrap do rtc-v2-devices. */
class FakeLkMic implements LocalTrackLike {
  readonly source = "microphone" as const;
  stopOnMute = true;
  isMuted = false;
  mediaStreamTrack: FakeMST;
  restarts = 0;
  private endedFns = new Set<() => void>();
  constructor(
    private device: () => string,
    public sender: { track: FakeMST | null },
  ) {
    this.mediaStreamTrack = new FakeMST(device());
    this.sender.track = this.mediaStreamTrack;
    this.bind();
  }
  private bind() {
    const mst = this.mediaStreamTrack;
    mst.listeners.add(() => {
      if (mst === this.mediaStreamTrack) for (const f of [...this.endedFns]) f();
    });
  }
  stop() {
    this.mediaStreamTrack.stop();
  }
  onEnded(fn: () => void) {
    this.endedFns.add(fn);
    return () => this.endedFns.delete(fn);
  }
  async mute() {
    if (this.isMuted) return;
    if (this.stopOnMute) this.mediaStreamTrack.stop();
    this.isMuted = true;
  }
  async unmute() {
    if (!this.isMuted) return;
    if (this.stopOnMute || this.mediaStreamTrack.readyState === "ended") {
      this.mediaStreamTrack = new FakeMST(this.device());
      this.sender.track = this.mediaStreamTrack; // replaceTrack no mesmo sender
      this.restarts++;
      this.bind();
    }
    this.isMuted = false;
  }
  isEnded() {
    return this.mediaStreamTrack.readyState === "ended";
  }
  async setDevice(id: string) {
    selected = id;
    if (this.isMuted) return true; // LiveKit: pendente até o unmute
    this.mediaStreamTrack.stop();
    this.mediaStreamTrack = new FakeMST(id);
    this.sender.track = this.mediaStreamTrack;
    this.bind();
    return true;
  }
}

let selected = "builtin";

class Room implements PublishTargetLike {
  published = new Set<LocalTrackLike>();
  publishCalls = 0;
  async publishTrack(t: LocalTrackLike) {
    this.publishCalls++;
    this.published.add(t);
  }
  async unpublishTrack(t: LocalTrackLike) {
    this.published.delete(t);
  }
  micPubs() {
    return [...this.published].filter((t) => t.source === "microphone").length;
  }
}

function setup() {
  selected = "builtin";
  const sender = { track: null as FakeMST | null };
  const created: FakeLkMic[] = [];
  const adapter: CaptureAdapter = {
    async createMicrophoneTrack() {
      const t = new FakeLkMic(() => selected, sender);
      created.push(t);
      return t;
    },
    async createCameraTrack() {
      throw new Error("no");
    },
    async createScreenTracks() {
      return [];
    },
  };

  const lm = new LocalMedia(adapter);
  const room = new Room();
  return { lm, room, created, sender };
}

/** O que o VU meter usa: MediaStreamTrack atual quando status ON. */
function vuTrack(lm: LocalMedia): FakeMST | null {
  if (lm.getSnapshot().microphone.status !== "on") return null;
  return ((lm.getTrack("microphone") as unknown as FakeLkMic) ?? null)?.mediaStreamTrack ?? null;
}

describe("Mic privacy lifecycle (stopOnMute)", () => {
  it("20 ciclos OFF→ON: mesma publicação, captura parada no OFF, nova captura no ON", async () => {
    const { lm, room, created, sender } = setup();
    await lm.attachRoom(room);
    await lm.setMicrophoneEnabled(true);
    const track = created[0];
    expect(room.micPubs()).toBe(1);
    const seen = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const before = track.mediaStreamTrack;
      await lm.setMicrophoneEnabled(false);
      expect(before.readyState).toBe("ended"); // captura real parada
      expect(lm.getSnapshot().microphone.status).toBe("off");
      expect(vuTrack(lm)).toBeNull();
      expect(room.micPubs()).toBe(1);

      await lm.setMicrophoneEnabled(true);
      const cur = track.mediaStreamTrack;
      expect(cur).not.toBe(before);
      expect(cur.readyState).toBe("live");
      expect(cur.deviceId).toBe("builtin");
      expect(sender.track).toBe(cur); // sender correto
      expect(vuTrack(lm)).toBe(cur); // VU meter na track atual
      expect(lm.getTrack("microphone")).toBe(track);
      expect(room.micPubs()).toBe(1);
      expect(lm.getSnapshot().microphone.error).toBeNull();
      expect(seen.has(cur.id)).toBe(false);
      seen.add(cur.id);
    }
    expect(created).toHaveLength(1); // nunca recriou a track
    expect(room.publishCalls).toBe(1); // nunca republicou
    expect(track.restarts).toBe(20);
  });

  it("parada voluntária não é tratada como perda de hardware", async () => {
    const { lm, room, created } = setup();
    await lm.attachRoom(room);
    await lm.setMicrophoneEnabled(true);
    await lm.setMicrophoneEnabled(false);
    // mesmo um "ended" tardio da track parada é ignorado
    created[0].mediaStreamTrack.hardwareLoss();
    await Promise.resolve();
    const s = lm.getSnapshot().microphone;
    expect(s.status).toBe("off");
    expect(s.error).toBeNull();
    expect(lm.getTrack("microphone")).toBe(created[0]);
    expect(room.micPubs()).toBe(1);
  });

  it("perda real com mic ON gera erro e descarta a track", async () => {
    const { lm, room, created } = setup();
    await lm.attachRoom(room);
    await lm.setMicrophoneEnabled(true);
    created[0].mediaStreamTrack.hardwareLoss();
    await new Promise((r) => setTimeout(r, 0));
    const s = lm.getSnapshot().microphone;
    expect(s.status).toBe("error");
    expect(room.micPubs()).toBe(0);
    // próximo ON readquire com 1 publicação
    await lm.setMicrophoneEnabled(true);
    expect(created).toHaveLength(2);
    expect(room.micPubs()).toBe(1);
  });

  it("troca de dispositivo com mic OFF vale na retomada; com ON é imediata", async () => {
    const { lm, room, created, sender } = setup();
    await lm.attachRoom(room);
    await lm.setMicrophoneEnabled(true);
    await lm.setMicrophoneEnabled(false);
    await lm.setMicrophoneDevice("usb");
    expect(created[0].mediaStreamTrack.readyState).toBe("ended"); // não reabriu
    await lm.setMicrophoneEnabled(true);
    expect(created[0].mediaStreamTrack.deviceId).toBe("usb");
    await lm.setMicrophoneDevice("bt");
    expect(created[0].mediaStreamTrack.deviceId).toBe("bt");
    expect(sender.track).toBe(created[0].mediaStreamTrack);
    expect(created).toHaveLength(1);
    expect(room.micPubs()).toBe(1);
  });

  it("OFF→ON rápidos concorrentes não duplicam publicação", async () => {
    const { lm, room, created } = setup();
    await lm.attachRoom(room);
    await lm.setMicrophoneEnabled(true);
    await Promise.all(
      Array.from({ length: 20 }, (_, i) => lm.setMicrophoneEnabled(i % 2 === 1)),
    );
    expect(created).toHaveLength(1);
    expect(room.micPubs()).toBe(1);
    expect(lm.getSnapshot().microphone.status).toBe("on");
  });
});
