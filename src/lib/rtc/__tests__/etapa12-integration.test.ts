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

// ---- Etapa 12B: guardas estáticas + identidade do runtime ----
import { readFileSync } from "node:fs";
import { runtimeKey } from "../useLiveKit-v2";

const src = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url), "utf8");

describe("runtimeKey (takeover/StrictMode)", () => {
  const cfg = { workspaceId: "w", sessionId: "s", generation: 2, active: true };
  it("null quando sessão não ACTIVE (takeover → dispose)", () => {
    expect(runtimeKey("u", { ...cfg, active: false })).toBeNull();
    expect(runtimeKey(null, cfg)).toBeNull();
  });
  it("muda com generation/sessão (novo runtime), estável caso contrário", () => {
    expect(runtimeKey("u", cfg)).toBe(runtimeKey("u", { ...cfg }));
    expect(runtimeKey("u", cfg)).not.toBe(runtimeKey("u", { ...cfg, generation: 3 }));
  });
});

describe("guardas estáticas do path v2", () => {
  const v2 = src("lib/rtc/useLiveKit-v2.ts") + src("lib/rtc/rtc-v2-runtime.ts");
  const scene = src("components/office/OfficeScene.tsx");
  it("V2 não usa desiredPeers/videoVisibleIds/audiblePeerIds/clientId/participantOwnerId", () => {
    for (const w of [
      "desiredPeers",
      "audiblePeerIds",
      "participantOwnerId",
      "clientId",
      "sessionStorage",
    ])
      expect(v2).not.toContain(w);
    // parâmetros legados recebidos pela assinatura são ignorados
    expect(v2).toMatch(/_legacyRoomKey/);
    expect(v2).toMatch(/_legacyVisibleIds/);
  });
  it("OfficeScene em v2 não passa roomKey/videoVisibleIds e não abre transports legados", () => {
    expect(scene).toMatch(/IS_RTC_V2 \? null : roomKey/);
    expect(scene).toMatch(/IS_RTC_V2 \? null : audiblePeerIds/);
    expect(scene).toMatch(/if \(!IS_RTC_V2\) ch\.subscribe\(\)/);
    expect(scene).toMatch(/if \(!IS_RTC_V2\) positionBroadcastCh\.subscribe/);
    expect(scene).toMatch(/if \(!IS_RTC_V2\) presenceCh\.subscribe/);
    expect(scene).toMatch(/presenceHeartbeat = IS_RTC_V2 \? 0/);
    expect(scene).toMatch(/positionsPoll = IS_RTC_V2 \? 0/);
    expect(scene).toMatch(/persistHeartbeat = IS_RTC_V2 \? 0/);
    expect(scene).toMatch(/IS_RTC_V2 \? rtc\.connectedPeers/);
    expect(scene).toMatch(/if \(IS_RTC_V2\) return rtc\.remoteStreams/);
  });
  it("zona do path v2 usa a regra canônica compartilhada com o Token V2", () => {
    expect(scene).toMatch(/IS_RTC_V2 \? \(zoneIdAtPoint\(loadOverrides\(\), p\)/);
    expect(src("lib/rtc/livekit-token-v2.ts")).toMatch(/from "\.\/canonical-zones"/);
    expect(src("lib/rtc/rtc-v2-runtime.ts")).toMatch(/from "\.\/canonical-zones"/);
  });
  it("fachada chama um único hook por execução", () => {
    const f = src("lib/rtc/useLiveKit.ts");
    expect(f).toMatch(/export const useLiveKit: Hook = selectLiveKitHook\(ACTIVE_RTC_ENGINE\)/);
    expect(src("lib/rtc/rtc-engine.ts")).toMatch(/v1/);
  });
});
