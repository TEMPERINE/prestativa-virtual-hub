/**
 * Etapa 12B — runtime V2 integrado (módulos reais, só transporte/Room falsos).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RtcV2Runtime, type TokenV2Request, type V2Room } from "../rtc-v2-runtime";
import type { MovementEvent, MovementTransport } from "../movement-realtime";
import type { PresenceTransport } from "../office-presence";
import type { RtcEventRow } from "../rtc-telemetry";

const REUNIAO = { x: 0.8, y: 0.2 };
const FEEDBACK = { x: 0.86, y: 0.7 };
const LOBBY = { x: 0.5, y: 0.42 };

class FakeRoom {
  static all: FakeRoom[] = [];
  static live = 0;
  static maxLive = 0;
  handlers = new Map<string, Set<(...a: unknown[]) => void>>();
  remoteParticipants = new Map<
    string,
    { identity: string; trackPublications: Map<string, unknown> }
  >();
  opts: { autoSubscribe: boolean } | null = null;
  token = "";
  connected = false;
  constructor() {
    FakeRoom.all.push(this);
  }
  async connect(_u: string, token: string, opts: { autoSubscribe: boolean }) {
    this.token = token;
    this.opts = opts;
    this.connected = true;
    FakeRoom.live++;
    FakeRoom.maxLive = Math.max(FakeRoom.maxLive, FakeRoom.live);
  }
  async disconnect() {
    if (this.connected) FakeRoom.live--;
    this.connected = false;
  }
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
  addRemote(identity: string) {
    this.remoteParticipants.set(identity, { identity, trackPublications: new Map() });
    this.fire("participantConnected", this.remoteParticipants.get(identity));
  }
  async publishTrack() {}
  async unpublishTrack() {}
}

function harness(opts: { staleTimes?: number } = {}) {
  const tokenCalls: TokenV2Request[] = [];
  let staleLeft = opts.staleTimes ?? 0;
  const rows: RtcEventRow[] = [];
  const sent: MovementEvent[] = [];
  const presencePayloads: unknown[] = [];
  const closed = { movement: 0, presence: 0, untrack: 0 };
  let movementHandlers: Parameters<MovementTransport["open"]>[0] | null = null;
  const movementTransport: MovementTransport = {
    open(h) {
      movementHandlers = h;
      queueMicrotask(() => h.onSubscribed(false));
      return { send: (e) => sent.push(e), close: () => void closed.movement++ };
    },
  };
  const presenceTransport: PresenceTransport = {
    open(h) {
      queueMicrotask(() => h.onSubscribed());
      return {
        track: (p) => void presencePayloads.push(p),
        untrack: () => void closed.untrack++,
        close: () => void closed.presence++,
      };
    },
  };
  let mapVersion = 1;
  const refreshMap = vi.fn(() => {
    rt.setMap({ state: "SYNCING", version: mapVersion, map: null });
    queueMicrotask(() => {
      mapVersion++;
      rt.setMap({ state: "READY", version: mapVersion, map: null });
    });
  });
  const rt: RtcV2Runtime = new RtcV2Runtime(
    { userId: "me", workspaceId: "ws", sessionId: "s1", generation: 3 },
    {
      fetchToken: async (req) => {
        tokenCalls.push(req);
        if (req.context === "PRIVATE_ROOM" && staleLeft > 0) {
          staleLeft--;
          throw new Error("MAP_VERSION_STALE");
        }
        return {
          url: "wss://x",
          token: `${req.context}:${req.context === "PRIVATE_ROOM" ? req.zoneId : ""}`,
        };
      },
      roomFactory: () => new FakeRoom() as unknown as V2Room,
      capture: {
        createMicrophoneTrack: async () => ({ kind: "audio" }) as never,
        createCameraTrack: async () => ({ kind: "video" }) as never,
        createScreenTracks: async () => [],
      },
      movementTransport,
      presenceTransport,
      telemetryAdapter: { insertEvents: async (r) => void rows.push(...r) },
      refreshMap,
    },
  );
  rt.setMap({ state: "READY", version: mapVersion, map: null });
  return {
    rt,
    tokenCalls,
    rows,
    sent,
    presencePayloads,
    closed,
    refreshMap,
    remoteMove: (e: MovementEvent) => movementHandlers?.onEvent(e),
  };
}

const settle = async (ms = 0) => {
  await vi.advanceTimersByTimeAsync(ms);
  for (let i = 0; i < 30; i++) await Promise.resolve();
  await vi.advanceTimersByTimeAsync(0);
};

beforeEach(() => {
  vi.useFakeTimers();
  FakeRoom.all = [];
  FakeRoom.live = 0;
  FakeRoom.maxLive = 0;
});
afterEach(() => {
  vi.useRealTimers();
});

describe("RtcV2Runtime integrado", () => {
  it("inicia no LOBBY com autoSubscribe=false, mic/cam OFF, Presence sem posição", async () => {
    const h = harness();
    h.rt.start();
    h.rt.setSelfPosition(LOBBY.x, LOBBY.y);
    await settle(400);
    const s = h.rt.getSnapshot();
    expect(s.context.kind).toBe("LOBBY");
    expect(s.roomStatus).toBe("CONNECTED");
    expect(FakeRoom.all.at(-1)!.opts).toEqual({ autoSubscribe: false });
    expect(s.local.microphone.status).toBe("off");
    expect(s.local.camera.status).toBe("off");
    expect(h.presencePayloads.length).toBeGreaterThan(0);
    for (const p of h.presencePayloads) {
      const keys = Object.keys(p as object);
      for (const banned of ["x", "y", "vx", "vy", "zone", "position", "velocity"])
        expect(keys).not.toContain(banned);
    }
    await h.rt.dispose();
  });

  it("PRIVATE_ROOM: autoSubscribe=true e roster = participantes da Room, sem posições remotas", async () => {
    const h = harness();
    h.rt.start();
    h.rt.setSelfPosition(REUNIAO.x, REUNIAO.y);
    await settle(400);
    expect(h.rt.getSnapshot().context).toEqual({ kind: "PRIVATE_ROOM", zoneId: "reuniao" });
    const room = FakeRoom.all.at(-1)!;
    expect(room.opts).toEqual({ autoSubscribe: true });
    // remoto sem nenhuma posição conhecida (e depois muito longe) ainda está no roster
    room.addRemote("u2");
    room.addRemote("u3");
    await settle();
    expect([...h.rt.getSnapshot().mediaPeers].sort()).toEqual(["u2", "u3"]);
    h.remoteMove({
      type: "POSITION_SYNC",
      userId: "u2",
      sessionId: "x",
      generation: 1,
      seq: 1,
      t: Date.now(),
      x: 0.05,
      y: 0.95,
      vx: 0,
      vy: 0,
      moving: false,
    } as MovementEvent);
    await settle(400);
    expect([...h.rt.getSnapshot().mediaPeers].sort()).toEqual(["u2", "u3"]);
    // posição de outro usuário não altera o contexto local
    expect(h.rt.getSnapshot().context).toEqual({ kind: "PRIVATE_ROOM", zoneId: "reuniao" });
    await h.rt.dispose();
  });

  it("Lobby → A → B rápido converge só em B; nunca duas Rooms ativas", async () => {
    const h = harness();
    h.rt.start();
    h.rt.setSelfPosition(LOBBY.x, LOBBY.y);
    await settle(400);
    h.rt.setSelfPosition(REUNIAO.x, REUNIAO.y);
    await settle(100);
    h.rt.setSelfPosition(FEEDBACK.x, FEEDBACK.y);
    await settle(800);
    const s = h.rt.getSnapshot();
    expect(s.context).toEqual({ kind: "PRIVATE_ROOM", zoneId: "feedback" });
    expect(s.roomStatus).toBe("CONNECTED");
    expect(FakeRoom.maxLive).toBe(1);
    expect(
      h.tokenCalls
        .filter((c) => c.context === "PRIVATE_ROOM")
        .map((c) => (c as { zoneId: string }).zoneId),
    ).toEqual(["feedback"]);
    await h.rt.dispose();
  });

  it("reconnect nativo (reconnecting/reconnected) não cria nova Room", async () => {
    const h = harness();
    h.rt.start();
    h.rt.setSelfPosition(LOBBY.x, LOBBY.y);
    await settle(400);
    const n = FakeRoom.all.length;
    const room = FakeRoom.all.at(-1)!;
    room.fire("reconnecting");
    await settle();
    expect(h.rt.getSnapshot().roomStatus).toBe("RECONNECTING");
    room.fire("reconnected");
    await settle(5000);
    expect(h.rt.getSnapshot().roomStatus).toBe("CONNECTED");
    expect(FakeRoom.all.length).toBe(n);
    expect(h.tokenCalls.length).toBe(1);
    await h.rt.dispose();
  });

  it("MAP_VERSION_STALE: MAP_STALE → mapa READY → UMA nova tentativa (3 tokens no total)", async () => {
    const h = harness({ staleTimes: 1 });
    h.rt.start();
    h.rt.setSelfPosition(REUNIAO.x, REUNIAO.y);
    await settle(400);
    await settle(2000);
    const s = h.rt.getSnapshot();
    expect(h.refreshMap).toHaveBeenCalledTimes(1);
    const priv = h.tokenCalls.filter((c) => c.context === "PRIVATE_ROOM");
    expect(priv.map((c) => c.mapVersion)).toEqual([1, 2]);
    expect(h.tokenCalls.length).toBe(
      priv.length + h.tokenCalls.filter((c) => c.context === "LOBBY").length,
    );
    expect(priv.length).toBe(2);
    expect(s.roomStatus).toBe("CONNECTED");
    expect(s.context).toEqual({ kind: "PRIVATE_ROOM", zoneId: "reuniao" });
    await h.rt.dispose();
    const types = h.rows.map((r) => r.event_type);
    const iReq = types.indexOf("ROOM_CONNECT_REQUESTED");
    const iStale = types.indexOf("MAP_STALE");
    expect(iReq).toBeGreaterThanOrEqual(0);
    expect(iStale).toBeGreaterThan(iReq);
    expect(types.lastIndexOf("ROOM_CONNECT_REQUESTED")).toBeGreaterThan(iStale);
  });

  it("MAP_VERSION_STALE duas vezes: para em erro recuperável, sem loop", async () => {
    const h = harness({ staleTimes: 99 });
    h.rt.start();
    h.rt.setSelfPosition(REUNIAO.x, REUNIAO.y);
    await settle(400);
    await settle(120_000);
    const priv = h.tokenCalls.filter((c) => c.context === "PRIVATE_ROOM");
    expect(priv.length).toBe(2);
    expect(h.refreshMap).toHaveBeenCalledTimes(1);
    expect(h.rt.getSnapshot().roomStatus).toBe("ERROR");
    // recuperável: retry explícito faz exatamente mais uma tentativa
    h.rt.retry();
    await settle(100);
    expect(h.tokenCalls.filter((c) => c.context === "PRIVATE_ROOM").length).toBe(3);
    await h.rt.dispose();
  });

  it("takeover (sessão não ACTIVE) desconecta; dispose remove Room, canais e timers", async () => {
    const h = harness();
    h.rt.start();
    h.rt.setSelfPosition(LOBBY.x, LOBBY.y);
    h.rt.reportMotion(0.51, 0.42, 0.1, 0);
    await settle(400);
    expect(FakeRoom.live).toBe(1);
    h.rt.setSessionActive(false);
    await settle(10);
    expect(h.rt.getSnapshot().context.kind).toBe("OFFLINE");
    expect(FakeRoom.live).toBe(0);
    await h.rt.dispose();
    expect(h.closed.movement).toBe(1);
    expect(h.closed.presence).toBe(1);
    expect(h.rt.getSnapshot().disposed).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
