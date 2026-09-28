import { describe, expect, it, vi } from "vitest";
import { mountDeferred } from "../rtc-v2-mount";
import { StreamCache, buildRemoteStreams } from "../rtc-v2-streams";
import { mapRoomStatus } from "../useLiveKit-v2";
import { selectLiveKitHook } from "../useLiveKit";
import { useLiveKitV2 } from "../useLiveKit-v2";

function manualTimers() {
  const q: Array<{ fn: () => void; id: number }> = [];
  let id = 0;
  return {
    setTimeout: (fn: () => void) => (q.push({ fn, id: ++id }), id),
    clearTimeout: (h: unknown) => {
      const i = q.findIndex((e) => e.id === h);
      if (i >= 0) q.splice(i, 1);
    },
    flush: async () => {
      while (q.length) q.shift()!.fn();
      await new Promise((r) => setTimeout(r, 0));
    },
  };
}

describe("fachada useLiveKit", () => {
  it("v2 seleciona somente o hook v2; v1 não é o hook v2", () => {
    expect(selectLiveKitHook("v2")).toBe(useLiveKitV2);
    expect(selectLiveKitHook("v1")).not.toBe(useLiveKitV2);
  });
});

describe("mountDeferred (StrictMode)", () => {
  it("setup→cleanup→setup cria exatamente um runtime", async () => {
    const t = manualTimers();
    const created: Array<{ start: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> }> =
      [];
    const make = () => {
      const r = { start: vi.fn(), dispose: vi.fn() };
      created.push(r);
      return r;
    };
    const c1 = mountDeferred(make, () => {}, t);
    c1();
    const ready = vi.fn();
    const c2 = mountDeferred(make, ready, t);
    await t.flush();
    expect(created).toHaveLength(1);
    expect(created[0].start).toHaveBeenCalledOnce();
    expect(ready).toHaveBeenCalledOnce();
    c2();
    expect(created[0].dispose).toHaveBeenCalledOnce();
  });

  it("cancelado durante criação assíncrona descarta sem start", async () => {
    const t = manualTimers();
    const r = { start: vi.fn(), dispose: vi.fn() };
    let resolve!: (v: typeof r) => void;
    const cancel = mountDeferred(
      () => new Promise<typeof r>((res) => (resolve = res)),
      () => {},
      t,
    );
    await t.flush();
    cancel();
    resolve(r);
    await new Promise((x) => setTimeout(x, 0));
    expect(r.start).not.toHaveBeenCalled();
    expect(r.dispose).toHaveBeenCalledOnce();
  });
});

describe("streams", () => {
  const trk = (id: string) => ({ id }) as MediaStreamTrack;
  const info = (id: string) => ({ subscribed: true, track: { mediaStreamTrack: trk(id) } });
  it("reaproveita stream com mesmas tracks e filtra por permitido", () => {
    const av = new StreamCache((ts) => ({ ts }));
    const sc = new StreamCache((ts) => ({ ts }));
    const snap = {
      participants: [
        {
          identity: "a",
          microphone: info("m1"),
          camera: null,
          screenShare: null,
          screenShareAudio: null,
        },
        {
          identity: "b",
          microphone: info("m2"),
          camera: null,
          screenShare: null,
          screenShareAudio: null,
        },
      ],
    } as never;
    const r1 = buildRemoteStreams(snap, new Set(["a"]), av, sc);
    const r2 = buildRemoteStreams(snap, new Set(["a"]), av, sc);
    expect(Object.keys(r1.remoteStreams)).toEqual(["a"]);
    expect(r1.remoteStreams.a).toBe(r2.remoteStreams.a);
  });
});

describe("mapRoomStatus", () => {
  it("mapeia estados", () => {
    expect(mapRoomStatus(null, null)).toBe("idle");
    expect(mapRoomStatus("CONNECTED", null)).toBe("connected");
    expect(mapRoomStatus("RECONNECTING", null)).toBe("reconnecting");
    expect(mapRoomStatus("ERROR", null)).toBe("error");
    expect(mapRoomStatus("DISCONNECTED", { kind: "OFFLINE" } as never)).toBe("idle");
    expect(mapRoomStatus("DISCONNECTED", { kind: "LOBBY" } as never)).toBe("connecting");
  });
});
