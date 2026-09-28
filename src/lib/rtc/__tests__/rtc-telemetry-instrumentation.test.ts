import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RtcTelemetry, type RtcEventRow, type TelemetryAdapter } from "@/lib/rtc/rtc-telemetry";
import type { RtcTelemetrySink } from "@/lib/rtc/rtc-telemetry-types";
import { OfficeSessionController, type OfficeSessionBackend } from "@/lib/rtc/office-session";
import { MediaContextController } from "@/lib/rtc/media-context";
import {
  LiveKitRoomManager,
  type RoomEventName,
  type RoomLike,
  type TokenProvider,
} from "@/lib/rtc/livekit-room-manager";
import { LocalMedia, type CaptureAdapter, type LocalTrackLike } from "@/lib/rtc/local-media";
import { RemoteMedia, type RemoteRoomLike } from "@/lib/rtc/remote-media";
import { OfficePresence } from "@/lib/rtc/office-presence";
import { MovementRealtime, type MovementTransportHandlers } from "@/lib/rtc/movement-realtime";

const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.sig_abcdefgh";

// ─── fakes ─────────────────────────────────────────────────────
function recAdapter(fail = false) {
  const rows: RtcEventRow[] = [];
  const adapter: TelemetryAdapter = {
    async insertEvents(b) {
      if (fail) throw new Error("db down");
      rows.push(...b);
    },
  };
  return { adapter, rows };
}
const emptySession = { workspaceId: null, sessionId: null, generation: null };

class FakeRoom implements RoomLike {
  handlers = new Map<string, Set<(...a: unknown[]) => void>>();
  published: LocalTrackLike[] = [];
  async connect() {}
  async disconnect() {}
  on(e: RoomEventName, fn: (...a: unknown[]) => void) {
    if (!this.handlers.has(e)) this.handlers.set(e, new Set());
    this.handlers.get(e)!.add(fn);
  }
  off(e: RoomEventName, fn: (...a: unknown[]) => void) {
    this.handlers.get(e)?.delete(fn);
  }
  fire(e: RoomEventName, ...a: unknown[]) {
    for (const fn of [...(this.handlers.get(e) ?? [])]) fn(...a);
  }
  async publishTrack(t: LocalTrackLike) {
    this.published.push(t);
  }
  async unpublishTrack(t: LocalTrackLike) {
    this.published = this.published.filter((x) => x !== t);
  }
}

const track = (source: LocalTrackLike["source"]): LocalTrackLike => ({
  source,
  stop: vi.fn(),
  onEnded: () => () => {},
});
const capture = (failMic = false): CaptureAdapter => ({
  createMicrophoneTrack: async () => {
    if (failMic) throw Object.assign(new Error("denied"), { name: "NotAllowedError" });
    return track("microphone");
  },
  createCameraTrack: async () => track("camera"),
  createScreenTracks: async () => [track("screen_share")],
});

const tokens: TokenProvider = async (ctx) => ({
  url: "wss://lk.example",
  token: JWT,
  roomName: `prestativa-office:w1:${ctx.kind === "LOBBY" ? "lobby" : ctx.zoneId}`,
});

function sessionBackend(): OfficeSessionBackend {
  return {
    claim: async (sessionId) => ({ sessionId, generation: 1 }),
    release: async () => true,
    fetchCurrent: async () => ({ sessionId: "s1", generation: 1, active: true }),
    openTakeoverChannel: () => ({ broadcastReplaced: async () => {}, unsubscribe: async () => {} }),
  };
}

const flushAll = async () => {
  for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(0);
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("Etapa 11B — timeline integrada", () => {
  it("claim → LOBBY → PRIVATE_ROOM(sala-1) → connect → mic → reconnect → lobby", async () => {
    const { adapter, rows } = recAdapter();
    const tel = new RtcTelemetry({ adapter, session: emptySession });
    const rooms: FakeRoom[] = [];
    const session = new OfficeSessionController(sessionBackend(), () => "s1", tel);
    const ctx = new MediaContextController({
      resolveZone: (p) => (p.x > 0.5 ? { id: "sala-1", isPrivate: true } : null),
      telemetry: tel,
    });
    const rm = new LiveKitRoomManager({
      tokenProvider: tokens,
      roomFactory: () => {
        const r = new FakeRoom();
        rooms.push(r);
        return r;
      },
      telemetry: tel,
    });
    const local = new LocalMedia(capture(), tel);
    ctx.subscribe((s) => rm.setDesiredContext(s.context));

    await session.claim("u1", "w1");
    ctx.setSession("ACTIVE");
    ctx.setMap({ state: "READY", version: 7 });
    ctx.setSelfPosition({ x: 0.2, y: 0.2 });
    await flushAll();
    for (let i = 0; i < 30; i++) ctx.setSelfPosition({ x: 0.2 + i * 0.001, y: 0.2 }); // mesmo contexto
    ctx.setSelfPosition({ x: 0.8, y: 0.5 });
    await vi.advanceTimersByTimeAsync(300);
    await flushAll();
    const sala = rooms.at(-1)!;
    await local.attachRoom(sala);
    await local.setMicrophoneEnabled(true);
    sala.fire("reconnecting");
    sala.fire("reconnected");
    ctx.setSelfPosition({ x: 0.2, y: 0.2 });
    await flushAll();
    await tel.dispose();

    const seq = rows.map((r) => r.event_type);
    console.info("[timeline]", seq.join(" → "));
    const expected = [
      "SESSION_CLAIMED",
      "CONTEXT_CHANGE_REQUESTED",
      "CONTEXT_CHANGED",
      "ROOM_CONNECT_REQUESTED",
      "ROOM_SIGNAL_CONNECTED",
      "MIC_ON",
      "ROOM_MEDIA_ACTIVE",
      "ROOM_RECONNECTING",
      "ROOM_RECONNECTED",
      "CONTEXT_CHANGE_REQUESTED",
      "CONTEXT_CHANGED",
      "ROOM_DISCONNECTED",
    ];
    let i = 0;
    for (const t of seq) if (t === expected[i]) i++;
    expect(i).toBe(expected.length);

    // sala-1 aparece conectada e depois desconectada por troca de contexto
    const salaRows = rows.filter((r) => r.zone_id === "sala-1");
    expect(salaRows.map((r) => r.event_type)).toEqual(
      expect.arrayContaining(["ROOM_SIGNAL_CONNECTED", "ROOM_DISCONNECTED"]),
    );
    expect(
      rows.find((r) => r.event_type === "ROOM_SIGNAL_CONNECTED" && r.zone_id === "sala-1")
        ?.room_name,
    ).toBe("prestativa-office:w1:sala-1");
    // 30 posições no mesmo contexto não geraram eventos
    expect(seq.filter((t) => t === "CONTEXT_CHANGE_REQUESTED")).toHaveLength(3);
    // eventSeq monotônico e sessão associada
    const seqs = rows.map((r) => r.details.eventSeq as number);
    expect(seqs).toEqual(seqs.map((_, k) => k + 1));
    for (const r of rows)
      expect(r).toMatchObject({ session_id: "s1", generation: 1, workspace_id: "w1" });

    // privacidade
    const dump = JSON.stringify(rows);
    expect(dump).not.toContain(JWT);
    expect(dump).not.toContain("eyJ");
    expect(dump).not.toMatch(/"x"|"y"|"vx"|"vy"/);
    expect(dump).not.toMatch(/candidate:|v=0/);
  });
});

describe("Etapa 11B — RoomManager", () => {
  async function runFail(sink: RtcTelemetrySink | undefined, err: unknown) {
    const provider = vi.fn(async () => {
      throw err;
    });
    const rm = new LiveKitRoomManager({
      tokenProvider: provider,
      roomFactory: () => new FakeRoom(),
      telemetry: sink,
    });
    rm.setDesiredContext({ kind: "PRIVATE_ROOM", zoneId: "sala-1" });
    await rm.whenIdle();
    await vi.advanceTimersByTimeAsync(60_000);
    return { snap: rm.getSnapshot(), calls: provider.mock.calls.length };
  }

  it("falha de token: ROOM_CONNECT_FAILED e estado idêntico com/sem telemetria (inclusive adapter falhando)", async () => {
    const ok = recAdapter();
    const okTel = new RtcTelemetry({ adapter: ok.adapter, session: emptySession });
    const bad = new RtcTelemetry({ adapter: recAdapter(true).adapter, session: emptySession });
    const throwing: RtcTelemetrySink = {
      record: () => {
        throw new Error("sink boom");
      },
    };
    const none = await runFail(undefined, new Error("token failed"));
    const withTel = await runFail(okTel, new Error("token failed"));
    const withBad = await runFail(bad, new Error("token failed"));
    const withThrow = await runFail(throwing, new Error("token failed"));
    expect(none.snap.status).toBe("ERROR");
    for (const r of [withTel, withBad, withThrow]) expect(r).toEqual(none);
    await okTel.dispose();
    await bad.dispose();
    expect(ok.rows.map((r) => r.event_type)).toEqual([
      "ROOM_CONNECT_REQUESTED",
      "ROOM_CONNECT_FAILED",
    ]);
  });

  it("MAP_VERSION_STALE: REQUESTED → MAP_STALE → CONNECT_FAILED, sem retry", async () => {
    const { adapter, rows } = recAdapter();
    const tel = new RtcTelemetry({ adapter, session: emptySession });
    const r = await runFail(
      tel,
      Object.assign(new Error("MAP_VERSION_STALE"), { code: "MAP_VERSION_STALE" }),
    );
    await tel.dispose();
    expect(rows.map((x) => x.event_type)).toEqual([
      "ROOM_CONNECT_REQUESTED",
      "MAP_STALE",
      "ROOM_CONNECT_FAILED",
    ]);
    expect(r.calls).toBe(1);
    expect(r.snap.status).toBe("ERROR");
  });

  it("dois reconnects em momentos diferentes geram dois pares; Room antiga não gera telemetria", async () => {
    const { adapter, rows } = recAdapter();
    const tel = new RtcTelemetry({ adapter, session: emptySession });
    const rooms: FakeRoom[] = [];
    const rm = new LiveKitRoomManager({
      tokenProvider: tokens,
      roomFactory: () => {
        const r = new FakeRoom();
        rooms.push(r);
        return r;
      },
      telemetry: tel,
    });
    rm.setDesiredContext({ kind: "PRIVATE_ROOM", zoneId: "a" });
    await rm.whenIdle();
    const a = rooms[0];
    a.fire("reconnecting");
    a.fire("reconnected");
    a.fire("reconnecting");
    a.fire("reconnected");
    rm.setDesiredContext({ kind: "PRIVATE_ROOM", zoneId: "b" });
    await rm.whenIdle();
    const before = tel.diagnostics.buffered + tel.diagnostics.persisted;
    a.fire("reconnecting");
    a.fire("disconnected");
    expect(tel.diagnostics.buffered + tel.diagnostics.persisted).toBe(before);
    await tel.dispose();
    const t = rows.map((r) => r.event_type);
    expect(t.filter((x) => x === "ROOM_RECONNECTING")).toHaveLength(2);
    expect(t.filter((x) => x === "ROOM_RECONNECTED")).toHaveLength(2);
  });

  it("desconexão inesperada: ROOM_DISCONNECTED com motivo, sem CONNECT_FAILED", async () => {
    const { adapter, rows } = recAdapter();
    const tel = new RtcTelemetry({ adapter, session: emptySession });
    const room = new FakeRoom();
    const rm = new LiveKitRoomManager({
      tokenProvider: tokens,
      roomFactory: () => room,
      telemetry: tel,
    });
    rm.setDesiredContext({ kind: "LOBBY" });
    await rm.whenIdle();
    room.fire("disconnected", 2);
    await tel.dispose();
    const last = rows.at(-1)!;
    expect(last.event_type).toBe("ROOM_DISCONNECTED");
    expect(last.disconnect_reason).toBe("2");
    expect(rows.map((r) => r.event_type)).not.toContain("ROOM_CONNECT_FAILED");
    expect(rm.getSnapshot().status).toBe("ERROR");
  });
});

describe("Etapa 11B — OfficeSession", () => {
  it("SESSION_REPLACED uma única vez; eventos antigos/duplicados não reemitem", async () => {
    const { adapter, rows } = recAdapter();
    const tel = new RtcTelemetry({ adapter, session: emptySession });
    const s = new OfficeSessionController(sessionBackend(), () => "s1", tel);
    await s.claim("u1", "w1");
    s.handleReplaced({ sessionId: "old", generation: 1 }); // ignorado
    s.handleReplaced({ sessionId: "s2", generation: 2 });
    s.handleReplaced({ sessionId: "s2", generation: 2 });
    s.handleReplaced({ sessionId: "s3", generation: 3 });
    await s.revalidate();
    await tel.dispose();
    expect(rows.map((r) => r.event_type)).toEqual(["SESSION_CLAIMED", "SESSION_REPLACED"]);
    expect(rows[0]).toMatchObject({ session_id: "s1", generation: 1, workspace_id: "w1" });
  });

  it("claim com erro não emite SESSION_CLAIMED", async () => {
    const { adapter, rows } = recAdapter();
    const tel = new RtcTelemetry({ adapter, session: emptySession });
    const s = new OfficeSessionController(
      { ...sessionBackend(), claim: async () => Promise.reject(new Error("x")) },
      () => "s1",
      tel,
    );
    await s.claim("u1", "w1");
    await tel.dispose();
    expect(rows).toHaveLength(0);
  });
});

describe("Etapa 11B — MediaContext", () => {
  it("candidatura cancelada antes de 300 ms não gera CONTEXT_CHANGED falso", async () => {
    const { adapter, rows } = recAdapter();
    const tel = new RtcTelemetry({ adapter, session: emptySession });
    const ctx = new MediaContextController({
      resolveZone: (p) => (p.x > 0.5 ? { id: "sala-1", isPrivate: true } : null),
      telemetry: tel,
    });
    ctx.setSession("ACTIVE");
    ctx.setMap({ state: "READY", version: 1 });
    ctx.setSelfPosition({ x: 0.2, y: 0 });
    ctx.setSelfPosition({ x: 0.8, y: 0 });
    await vi.advanceTimersByTimeAsync(100);
    ctx.setSelfPosition({ x: 0.2, y: 0 });
    await vi.advanceTimersByTimeAsync(1000);
    await tel.dispose();
    const changed = rows.filter((r) => r.event_type === "CONTEXT_CHANGED");
    expect(changed.map((r) => r.context)).toEqual(["LOBBY"]);
    expect(
      rows.filter((r) => r.event_type === "CONTEXT_CHANGE_REQUESTED").map((r) => r.context),
    ).toEqual(["LOBBY", "PRIVATE_ROOM", "LOBBY"]);
  });
});

describe("Etapa 11B — LocalMedia / RemoteMedia", () => {
  it("troca de Room com mic ON não reemite MIC_ON; MEDIA_ACTIVE uma vez por Room", async () => {
    const { adapter, rows } = recAdapter();
    const tel = new RtcTelemetry({ adapter, session: emptySession });
    const lm = new LocalMedia(capture(), tel);
    const r1 = new FakeRoom();
    const r2 = new FakeRoom();
    await lm.attachRoom(r1);
    await lm.setMicrophoneEnabled(true);
    await lm.setCameraEnabled(true);
    await lm.attachRoom(r1); // reattach mesma Room
    await lm.attachRoom(r2);
    await lm.setMicrophoneEnabled(false);
    await lm.setMicrophoneEnabled(false);
    await lm.startScreenShare();
    await lm.stopScreenShare();
    await tel.dispose();
    expect(rows.map((r) => r.event_type)).toEqual([
      "MIC_ON",
      "ROOM_MEDIA_ACTIVE",
      "CAM_ON",
      "ROOM_MEDIA_ACTIVE",
      "MIC_OFF",
      "SCREEN_SHARE_ON",
      "SCREEN_SHARE_OFF",
    ]);
  });

  it("sozinho com mic/cam OFF: nenhum ROOM_MEDIA_ACTIVE", async () => {
    const { adapter, rows } = recAdapter();
    const tel = new RtcTelemetry({ adapter, session: emptySession });
    const lm = new LocalMedia(capture(), tel);
    await lm.attachRoom(new FakeRoom());
    await tel.dispose();
    expect(rows).toHaveLength(0);
  });

  it("permissão negada: MIC_ERROR e nunca MIC_ON", async () => {
    const { adapter, rows } = recAdapter();
    const tel = new RtcTelemetry({ adapter, session: emptySession });
    const lm = new LocalMedia(capture(true), tel);
    await lm.setMicrophoneEnabled(true);
    await tel.dispose();
    expect(rows.map((r) => r.event_type)).toEqual(["MIC_ERROR"]);
    expect(rows[0].details.errorCode).toBe("permission_denied");
    expect(lm.getSnapshot().microphone.status).toBe("error");
  });

  it("falha de telemetria não altera LocalMedia", async () => {
    const throwing: RtcTelemetrySink = {
      record: () => {
        throw new Error("boom");
      },
    };
    const a = new LocalMedia(capture());
    const b = new LocalMedia(capture(), throwing);
    const ra = new FakeRoom();
    const rb = new FakeRoom();
    for (const [lm, r] of [
      [a, ra],
      [b, rb],
    ] as const) {
      await lm.attachRoom(r);
      await lm.setMicrophoneEnabled(true);
    }
    expect(b.getSnapshot()).toEqual(a.getSnapshot());
    expect(rb.published.length).toBe(ra.published.length);
  });

  it("RemoteMedia: só TrackSubscribed com track real gera MEDIA_ACTIVE (deduplicado)", async () => {
    const { adapter, rows } = recAdapter();
    const tel = new RtcTelemetry({ adapter, session: emptySession });
    const handlers = new Map<string, Set<(...a: unknown[]) => void>>();
    const room: RemoteRoomLike & { fire(e: string, ...a: unknown[]): void } = {
      remoteParticipants: new Map(),
      on: (e, fn) => {
        if (!handlers.has(e)) handlers.set(e, new Set());
        handlers.get(e)!.add(fn);
      },
      off: (e, fn) => handlers.get(e)?.delete(fn),
      fire: (e, ...a) => handlers.get(e)?.forEach((fn) => fn(...a)),
    };
    const rmd = new RemoteMedia(tel);
    rmd.attachRoom(room);
    room.fire("trackPublished");
    room.fire("participantConnected");
    room.fire("trackMuted");
    room.fire("trackSubscribed", undefined);
    room.fire("trackSubscribed", { kind: "audio" });
    room.fire("trackSubscribed", { kind: "video" });
    rmd.detachRoom(room);
    room.fire("trackSubscribed", { kind: "audio" });
    await tel.dispose();
    expect(rows.map((r) => r.event_type)).toEqual(["ROOM_MEDIA_ACTIVE"]);
  });
});

describe("Etapa 11B — Presence / Movement", () => {
  it("PRESENCE_ERROR em erro real; sync/join/leave não geram telemetria", async () => {
    const { adapter, rows } = recAdapter();
    const tel = new RtcTelemetry({ adapter, session: emptySession });
    let handlers!: {
      onPresence: (k: "sync", s: object) => void;
      onSubscribed(): void;
      onError(m: string): void;
    };
    const p = new OfficePresence({
      self: { userId: "u1", sessionId: "s1", generation: 1, workspaceId: "w1" },
      transport: {
        open: (hs) => {
          handlers = hs as typeof handlers;
          return { track: () => {}, untrack: () => {}, close: () => {} };
        },
      },
      telemetry: tel,
    });
    p.start();
    handlers.onSubscribed();
    handlers.onPresence("sync", {
      a: [{ userId: "a", sessionId: "x", generation: 1, workspaceId: "w1", joinedAt: "t" }],
    });
    handlers.onError("ClientPresenceRateLimitReached");
    await p.dispose();
    await tel.dispose();
    expect(rows.map((r) => r.event_type)).toEqual(["PRESENCE_ERROR"]);
    expect(rows[0].details.errorCode).toBe("RATE_LIMITED");
    expect(JSON.stringify(rows)).not.toContain("joinedAt");
  });

  it("movimento normal nunca vira telemetria; só BROADCAST_ERROR", async () => {
    const { adapter, rows } = recAdapter();
    const tel = new RtcTelemetry({ adapter, session: emptySession });
    let hs!: MovementTransportHandlers;
    const m = new MovementRealtime({
      self: { userId: "u1", sessionId: "s1", generation: 1 },
      transport: {
        open: (h) => {
          hs = h;
          return { send: () => {}, close: () => {} };
        },
      },
      telemetry: tel,
    });
    m.start();
    hs.onSubscribed(false);
    for (let f = 0; f < 600; f++) {
      m.updateLocal(f * 0.001, 0.2, f < 300 ? 0.06 : 0, f < 300 ? 0 : 0.06);
      await vi.advanceTimersByTimeAsync(16);
    }
    m.updateLocal(0.6, 0.2, 0, 0);
    hs.onEvent({ type: "SNAPSHOT_REQUEST", userId: "u2", sessionId: "s2", generation: 1, seq: 1 });
    hs.onError?.("CHANNEL_ERROR");
    await m.dispose();
    await tel.dispose();
    expect(rows.map((r) => r.event_type)).toEqual(["BROADCAST_ERROR"]);
    expect(JSON.stringify(rows)).not.toMatch(/"x"|"y"|"vx"|"vy"|MOTION|POSITION/);
  });
});
