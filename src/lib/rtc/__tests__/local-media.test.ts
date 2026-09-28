import { describe, it, expect } from "vitest";
import {
  LocalMedia,
  type CaptureAdapter,
  type LocalSource,
  type LocalTrackLike,
  type PublishTargetLike,
} from "../local-media";

class FakeTrack implements LocalTrackLike {
  stopped = false;
  private ended = new Set<() => void>();
  constructor(public readonly source: LocalSource) {}
  stop() {
    this.stopped = true;
  }
  onEnded(fn: () => void) {
    this.ended.add(fn);
    return () => this.ended.delete(fn);
  }
  browserEnd() {
    this.stopped = true;
    for (const f of [...this.ended]) f();
  }
}

class FakeRoom implements PublishTargetLike {
  published = new Set<LocalTrackLike>();
  publishCalls = 0;
  async publishTrack(t: LocalTrackLike) {
    this.publishCalls++;
    this.published.add(t);
  }
  async unpublishTrack(t: LocalTrackLike) {
    this.published.delete(t);
  }
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve(v: T): void;
  reject(e: unknown): void;
}
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((r, j) => {
    resolve = r;
    reject = j;
  });
  return { promise, resolve, reject };
}

class FakeAdapter implements CaptureAdapter {
  created: FakeTrack[] = [];
  calls = { mic: 0, cam: 0, screen: 0 };
  fail: Partial<Record<"mic" | "cam" | "screen", unknown>> = {};
  manual: Deferred<void>[] | null = null;
  private async gate() {
    if (this.manual) {
      const d = deferred<void>();
      this.manual.push(d);
      await d.promise;
    }
  }
  async createMicrophoneTrack() {
    this.calls.mic++;
    await this.gate();
    if (this.fail.mic) throw this.fail.mic;
    const t = new FakeTrack("microphone");
    this.created.push(t);
    return t;
  }
  async createCameraTrack() {
    this.calls.cam++;
    await this.gate();
    if (this.fail.cam) throw this.fail.cam;
    const t = new FakeTrack("camera");
    this.created.push(t);
    return t;
  }
  async createScreenTracks() {
    this.calls.screen++;
    await this.gate();
    if (this.fail.screen) throw this.fail.screen;
    const ts = [new FakeTrack("screen_share"), new FakeTrack("screen_share_audio")];
    this.created.push(...ts);
    return ts;
  }
  live() {
    return this.created.filter((t) => !t.stopped);
  }
}

const denied = Object.assign(new Error("denied"), { name: "NotAllowedError" });
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("LocalMedia", () => {
  it("1. começa mic OFF e cam OFF", () => {
    const lm = new LocalMedia(new FakeAdapter());
    const s = lm.getSnapshot();
    expect(s.microphone).toEqual({ intent: false, status: "off", error: null });
    expect(s.camera).toEqual({ intent: false, status: "off", error: null });
    expect(s.screenShare.status).toBe("off");
  });

  it("2. construção não pede câmera/microfone", async () => {
    const a = new FakeAdapter();
    const lm = new LocalMedia(a);
    await lm.attachRoom(new FakeRoom());
    expect(a.calls).toEqual({ mic: 0, cam: 0, screen: 0 });
  });

  it("3. ligar mic cria/publica uma única track", async () => {
    const a = new FakeAdapter();
    const room = new FakeRoom();
    const lm = new LocalMedia(a);
    await lm.attachRoom(room);
    await lm.setMicrophoneEnabled(true);
    await lm.setMicrophoneEnabled(true);
    expect(a.calls.mic).toBe(1);
    expect(room.published.size).toBe(1);
    expect(lm.getSnapshot().microphone.status).toBe("on");
  });

  it("4. desligar mic despublica e para captura", async () => {
    const a = new FakeAdapter();
    const room = new FakeRoom();
    const lm = new LocalMedia(a);
    await lm.attachRoom(room);
    await lm.setMicrophoneEnabled(true);
    await lm.setMicrophoneEnabled(false);
    expect(room.published.size).toBe(0);
    expect(a.live()).toHaveLength(0);
    expect(lm.getSnapshot().microphone).toMatchObject({ intent: false, status: "off" });
  });

  it("5. ligar câmera cria/publica uma única track", async () => {
    const a = new FakeAdapter();
    const room = new FakeRoom();
    const lm = new LocalMedia(a);
    await lm.attachRoom(room);
    await lm.setCameraEnabled(true);
    await lm.setCameraEnabled(true);
    expect(a.calls.cam).toBe(1);
    expect([...room.published].map((t) => t.source)).toEqual(["camera"]);
  });

  it("6. desligar câmera despublica e para captura", async () => {
    const a = new FakeAdapter();
    const room = new FakeRoom();
    const lm = new LocalMedia(a);
    await lm.attachRoom(room);
    await lm.setCameraEnabled(true);
    await lm.setCameraEnabled(false);
    expect(room.published.size).toBe(0);
    expect(a.live()).toHaveLength(0);
  });

  it("7/8/10. troca de Room com mic+cam ON republica sem nova captura e sem publicação dupla", async () => {
    const a = new FakeAdapter();
    const r1 = new FakeRoom();
    const r2 = new FakeRoom();
    const lm = new LocalMedia(a);
    await lm.attachRoom(r1);
    await lm.setMicrophoneEnabled(true);
    await lm.setCameraEnabled(true);
    await lm.attachRoom(r2);
    expect(r1.published.size).toBe(0);
    expect([...r2.published].map((t) => t.source).sort()).toEqual(["camera", "microphone"]);
    expect(a.calls).toMatchObject({ mic: 1, cam: 1 });
    expect(a.live()).toHaveLength(2);
  });

  it("intent sobrevive a detach sem Room (lobby → conectando) e publica ao anexar", async () => {
    const a = new FakeAdapter();
    const r1 = new FakeRoom();
    const lm = new LocalMedia(a);
    await lm.setCameraEnabled(true); // sem Room ainda
    expect(a.calls.cam).toBe(1);
    await lm.attachRoom(r1);
    expect(r1.published.size).toBe(1);
    await lm.detachRoom(r1);
    expect(lm.getSnapshot().camera.intent).toBe(true);
    const r2 = new FakeRoom();
    await lm.attachRoom(r2);
    expect(r2.published.size).toBe(1);
  });

  it("9. mídia OFF permanece OFF após trocar Room", async () => {
    const a = new FakeAdapter();
    const lm = new LocalMedia(a);
    await lm.attachRoom(new FakeRoom());
    const r2 = new FakeRoom();
    await lm.attachRoom(r2);
    expect(r2.published.size).toBe(0);
    expect(a.calls).toEqual({ mic: 0, cam: 0, screen: 0 });
  });

  it("reattach da mesma Room (reconnect) é no-op e mantém screen share", async () => {
    const a = new FakeAdapter();
    const r = new FakeRoom();
    const lm = new LocalMedia(a);
    await lm.attachRoom(r);
    await lm.startScreenShare();
    const calls = r.publishCalls;
    await lm.attachRoom(r);
    expect(lm.getSnapshot().screenShare.status).toBe("on");
    expect(r.publishCalls).toBe(calls);
  });

  it("11. screen share começa apenas por ação explícita", async () => {
    const a = new FakeAdapter();
    const r = new FakeRoom();
    const lm = new LocalMedia(a);
    await lm.attachRoom(r);
    expect(a.calls.screen).toBe(0);
    await lm.startScreenShare();
    expect(a.calls.screen).toBe(1);
    expect(r.published.size).toBe(2);
    expect(lm.getSnapshot().screenShare.status).toBe("on");
  });

  it("12/13. screen share termina ao mudar contexto e não volta na nova Room", async () => {
    const a = new FakeAdapter();
    const r1 = new FakeRoom();
    const r2 = new FakeRoom();
    const lm = new LocalMedia(a);
    await lm.attachRoom(r1);
    await lm.startScreenShare();
    await lm.attachRoom(r2);
    await flush();
    expect(r1.published.size).toBe(0);
    expect(r2.published.size).toBe(0);
    expect(a.live()).toHaveLength(0);
    expect(a.calls.screen).toBe(1);
    expect(lm.getSnapshot().screenShare.status).toBe("off");
  });

  it("14. browser encerrando compartilhamento atualiza estado", async () => {
    const a = new FakeAdapter();
    const r = new FakeRoom();
    const lm = new LocalMedia(a);
    await lm.attachRoom(r);
    await lm.startScreenShare();
    (a.created.find((t) => t.source === "screen_share") as FakeTrack).browserEnd();
    await flush();
    expect(lm.getSnapshot().screenShare.status).toBe("off");
    expect(r.published.size).toBe(0);
    expect(a.live()).toHaveLength(0);
  });

  it("15. permission denied não deixa estado em ON e não re-tenta sozinho", async () => {
    const a = new FakeAdapter();
    a.fail.mic = denied;
    a.fail.cam = denied;
    const r1 = new FakeRoom();
    const lm = new LocalMedia(a);
    await lm.attachRoom(r1);
    await lm.setMicrophoneEnabled(true);
    await lm.setCameraEnabled(true);
    const s = lm.getSnapshot();
    expect(s.microphone).toEqual({ intent: false, status: "error", error: "permission_denied" });
    expect(s.camera.status).toBe("error");
    await lm.attachRoom(new FakeRoom());
    expect(a.calls).toMatchObject({ mic: 1, cam: 1 });
    a.fail = {};
    await lm.setMicrophoneEnabled(true); // nova ação do usuário
    expect(lm.getSnapshot().microphone.status).toBe("on");
  });

  it("16. chamadas rápidas ON/OFF não deixam track fantasma", async () => {
    const a = new FakeAdapter();
    a.manual = [];
    const r = new FakeRoom();
    const lm = new LocalMedia(a);
    await lm.attachRoom(r);
    const p1 = lm.setMicrophoneEnabled(true);
    const p2 = lm.setMicrophoneEnabled(false);
    const p3 = lm.setMicrophoneEnabled(true);
    const p4 = lm.setMicrophoneEnabled(false);
    await flush();
    for (const d of a.manual) d.resolve();
    await Promise.all([p1, p2, p3, p4]);
    expect(a.live()).toHaveLength(0);
    expect(r.published.size).toBe(0);
    expect(lm.getSnapshot().microphone.status).toBe("off");
  });

  it("17. dispose() para todas as capturas", async () => {
    const a = new FakeAdapter();
    const r = new FakeRoom();
    const lm = new LocalMedia(a);
    await lm.attachRoom(r);
    await lm.setMicrophoneEnabled(true);
    await lm.setCameraEnabled(true);
    await lm.startScreenShare();
    await lm.dispose();
    await flush();
    expect(a.live()).toHaveLength(0);
    expect(r.published.size).toBe(0);
    const s = lm.getSnapshot();
    expect(s.microphone.intent).toBe(false);
    expect(s.camera.intent).toBe(false);
    expect(s.disposed).toBe(true);
  });

  it("18. Promise atrasada após dispose não publica mídia", async () => {
    const a = new FakeAdapter();
    a.manual = [];
    const r = new FakeRoom();
    const lm = new LocalMedia(a);
    await lm.attachRoom(r);
    const pm = lm.setMicrophoneEnabled(true);
    const pc = lm.setCameraEnabled(true);
    const ps = lm.startScreenShare();
    await flush();
    await lm.dispose();
    for (const d of a.manual) d.resolve();
    await Promise.all([pm, pc, ps]);
    expect(r.publishCalls).toBe(0);
    expect(a.live()).toHaveLength(0);
    await lm.setMicrophoneEnabled(true);
    expect(a.calls.mic).toBe(1);
  });
});
