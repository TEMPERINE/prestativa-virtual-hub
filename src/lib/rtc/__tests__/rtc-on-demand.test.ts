/**
 * RTC On Demand — Fase 1 (salas privadas).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  RtcDemandController,
  countOccupants,
  parseRtcOnDemand,
  type DemandInput,
} from "../rtc-demand-controller";
import { RtcV2Runtime, type TokenV2Request, type V2Room } from "../rtc-v2-runtime";
import type { MovementTransport } from "../movement-realtime";
import type { PresencePayload, PresenceTransport } from "../office-presence";
import { LocalMedia, type CaptureAdapter, type LocalTrackLike } from "../local-media";
import { MeetingTrackerV2 } from "@/lib/meetings/meeting-tracker-v2";
import { LiveKitRoomManager } from "../livekit-room-manager";

const REUNIAO = { x: 0.8, y: 0.2 };
const LOBBY = { x: 0.5, y: 0.42 };
const P = (zoneId: string) => ({ kind: "PRIVATE_ROOM" as const, zoneId });

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const settle = async (ms = 0) => {
  await vi.advanceTimersByTimeAsync(ms);
  for (let i = 0; i < 30; i++) await Promise.resolve();
  await vi.advanceTimersByTimeAsync(0);
};

function ctl(mode: "off" | "private" = "private") {
  const events: string[] = [];
  const c = new RtcDemandController({
    mode,
    graceMs: 15_000,
    telemetry: { record: (t) => void events.push(t) },
  });
  const up = (p: Partial<DemandInput>) =>
    c.update({ context: P("A"), occupants: 1, recordingActive: false, roomStatus: null, ...p });
  return { c, up, events };
}

describe("flag", () => {
  it("default off; aceita private/all", () => {
    expect(parseRtcOnDemand(undefined)).toBe("off");
    expect(parseRtcOnDemand("lixo")).toBe("off");
    expect(parseRtcOnDemand("PRIVATE")).toBe("private");
    expect(parseRtcOnDemand("all")).toBe("private"); // fallback Fase 1
  });
});

describe("RtcDemandController", () => {
  it("1. sozinho em private => NONE", () => {
    const { c, up } = ctl();
    up({});
    expect(c.getDemand()).toEqual({ kind: "NONE" });
  });
  it("2/3. segundo e terceiro => mesma PRIVATE", () => {
    const { c, up } = ctl();
    up({ occupants: 2 });
    expect(c.getDemand()).toEqual({ kind: "PRIVATE", zoneId: "A" });
    up({ occupants: 3 });
    expect(c.getDemand()).toEqual({ kind: "PRIVATE", zoneId: "A" });
  });
  it("4. nunca escolhe a zona de outro usuário", () => {
    // outros estão em B; só conto quem está na MINHA zona
    const others = [
      { userId: "u2", mediaLocation: "PRIVATE:B" },
      { userId: "u3", mediaLocation: "PRIVATE:B" },
    ];
    expect(countOccupants("me", "A", others)).toBe(1);
    const { c, up } = ctl();
    up({ occupants: countOccupants("me", "A", others) });
    expect(c.getDemand()).toEqual({ kind: "NONE" });
    up({ occupants: countOccupants("me", "A", [{ userId: "u2", mediaLocation: "PRIVATE:A" }]) });
    expect(c.getDemand()).toEqual({ kind: "PRIVATE", zoneId: "A" });
  });
  it("5/6. queda 2→1 arma grace; entrada cancela", () => {
    const { c, up, events } = ctl();
    up({ occupants: 2 });
    up({ occupants: 1 });
    expect(c.isGraceArmed()).toBe(true);
    expect(c.getDemand().kind).toBe("PRIVATE");
    vi.advanceTimersByTime(10_000);
    up({ occupants: 2 });
    expect(c.isGraceArmed()).toBe(false);
    vi.advanceTimersByTime(20_000);
    expect(c.getDemand().kind).toBe("PRIVATE");
    expect(events).toContain("RTC_SOLO_GRACE_ARMED");
    expect(events).toContain("RTC_SOLO_GRACE_CANCELLED");
  });
  it("7. grace expira => NONE", () => {
    const { c, up, events } = ctl();
    up({ occupants: 2 });
    up({ occupants: 1 });
    vi.advanceTimersByTime(15_000);
    expect(c.getDemand()).toEqual({ kind: "NONE" });
    expect(events).toContain("RTC_SOLO_GRACE_EXPIRED");
    expect(events.filter((e) => e === "RTC_DEMAND_CHANGED").length).toBe(2);
  });
  it("13/14. gravação impede idle; fim reavalia com grace", () => {
    const { c, up } = ctl();
    up({ occupants: 2 });
    up({ occupants: 1, recordingActive: true });
    vi.advanceTimersByTime(60_000);
    expect(c.getDemand().kind).toBe("PRIVATE");
    up({ occupants: 1, recordingActive: false });
    expect(c.isGraceArmed()).toBe(true);
    vi.advanceTimersByTime(15_000);
    expect(c.getDemand().kind).toBe("NONE");
  });
  it("gravação ativa sozinho mantém PRIVATE", () => {
    const { c, up } = ctl();
    up({ recordingActive: true });
    expect(c.getDemand().kind).toBe("PRIVATE");
  });
  it("21. RECONNECTING não expira o grace", () => {
    const { c, up } = ctl();
    up({ occupants: 2, roomStatus: "CONNECTED" });
    up({ occupants: 1, roomStatus: "RECONNECTING" });
    vi.advanceTimersByTime(45_000);
    expect(c.getDemand().kind).toBe("PRIVATE");
    up({ occupants: 1, roomStatus: "CONNECTED" });
    vi.advanceTimersByTime(15_000);
    expect(c.getDemand().kind).toBe("NONE");
  });
  it("lobby segue comportamento atual", () => {
    const { c, up } = ctl();
    up({ context: { kind: "LOBBY" } });
    expect(c.getDemand()).toEqual({ kind: "LOBBY" });
  });
  it("22. off: private sozinho continua PRIVATE", () => {
    const { c, up } = ctl("off");
    up({});
    expect(c.getDemand()).toEqual({ kind: "PRIVATE", zoneId: "A" });
  });
});

// ─── LocalMedia idle ───────────────────────────────────────────

function fakeTrack(source: "microphone" | "camera") {
  const t = {
    source,
    stopped: false,
    stop() {
      t.stopped = true;
    },
    onEnded: () => () => {},
  };
  return t as unknown as LocalTrackLike & { stopped: boolean };
}

function media() {
  const made: Array<LocalTrackLike & { stopped: boolean }> = [];
  const adapter: CaptureAdapter = {
    createMicrophoneTrack: async () => {
      const t = fakeTrack("microphone");
      made.push(t);
      return t;
    },
    createCameraTrack: async () => {
      const t = fakeTrack("camera");
      made.push(t);
      return t;
    },
    createScreenTracks: async () => [],
  };
  return { lm: new LocalMedia(adapter), made };
}

describe("LocalMedia em idle", () => {
  it("15/16/17. intents sobrevivem, captura física para, retorno restaura", async () => {
    const { lm, made } = media();
    await lm.setMicrophoneEnabled(true);
    await lm.setCameraEnabled(true);
    await lm.suspendCapture();
    expect(made.every((t) => t.stopped)).toBe(true);
    const s = lm.getSnapshot();
    expect(s.microphone.intent).toBe(true);
    expect(s.camera.intent).toBe(true);
    expect(s.microphone.status).toBe("off");
    expect(s.captureSuspended).toBe(true);
    await lm.resumeCapture();
    expect(lm.getSnapshot().microphone.status).toBe("on");
    expect(lm.getSnapshot().camera.status).toBe("on");
    expect(made.length).toBe(4);
  });
  it("18. câmera pausada pelo Privacy Guard não volta sozinha", async () => {
    const { lm } = media();
    await lm.setCameraEnabled(true);
    await lm.setCameraEnabled(false); // guard
    await lm.suspendCapture();
    await lm.resumeCapture();
    expect(lm.getSnapshot().camera.status).toBe("off");
  });
  it("ligar mic durante idle só registra intenção (sem captura)", async () => {
    const { lm, made } = media();
    await lm.suspendCapture();
    await lm.setMicrophoneEnabled(true);
    expect(made.length).toBe(0);
    expect(lm.getSnapshot().microphone.intent).toBe(true);
    await lm.resumeCapture();
    expect(made.length).toBe(1);
  });
});

// ─── Meeting tracker ───────────────────────────────────────────

describe("MeetingTrackerV2 com remoteCount", () => {
  const mk = () => {
    const joins: string[] = [];
    const leaves: string[] = [];
    const t = new MeetingTrackerV2({
      join: async (z) => {
        joins.push(z);
        return `m-${z}`;
      },
      leave: async (id) => void leaves.push(id),
    });
    return { t, joins, leaves };
  };
  it("10. sozinho conectado não cria meeting", async () => {
    const { t, joins } = mk();
    t.observe({ status: "CONNECTED", connected: P("A"), remoteCount: 0 });
    await t.whenIdle();
    expect(joins).toEqual([]);
  });
  it("11/12. segundo participante inicia; queda temporária mantém; Room cai => leave", async () => {
    const { t, joins, leaves } = mk();
    t.observe({ status: "CONNECTED", connected: P("A"), remoteCount: 1 });
    await t.whenIdle();
    expect(joins).toEqual(["A"]);
    t.observe({ status: "CONNECTED", connected: P("A"), remoteCount: 0 });
    await t.whenIdle();
    expect(leaves).toEqual([]);
    t.observe({ status: "DISCONNECTED", connected: null, remoteCount: 0 });
    await t.whenIdle();
    expect(leaves).toEqual(["m-A"]);
  });
  it("sem remoteCount mantém regra atual", async () => {
    const { t, joins } = mk();
    t.observe({ status: "CONNECTED", connected: P("A") });
    await t.whenIdle();
    expect(joins).toEqual(["A"]);
  });
});

// ─── Runtime integrado ─────────────────────────────────────────

class FakeRoom {
  static all: FakeRoom[] = [];
  handlers = new Map<string, Set<(...a: unknown[]) => void>>();
  remoteParticipants = new Map<string, { identity: string; trackPublications: Map<string, unknown> }>();
  connected = false;
  connects = 0;
  constructor() {
    FakeRoom.all.push(this);
  }
  async connect() {
    this.connected = true;
    this.connects++;
  }
  async disconnect() {
    this.connected = false;
  }
  on(e: string, fn: (...a: unknown[]) => void) {
    if (!this.handlers.has(e)) this.handlers.set(e, new Set());
    this.handlers.get(e)!.add(fn);
  }
  off(e: string, fn: (...a: unknown[]) => void) {
    this.handlers.get(e)?.delete(fn);
  }
  async publishTrack() {}
  async unpublishTrack() {}
}

function runtime(mode: "off" | "private") {
  FakeRoom.all = [];
  const tokens: TokenV2Request[] = [];
  const tracked: PresencePayload[] = [];
  let ph: Parameters<PresenceTransport["open"]>[0] | null = null;
  const movementTransport: MovementTransport = {
    open(h) {
      queueMicrotask(() => h.onSubscribed(false));
      return { send: () => {}, close: () => {} };
    },
  };
  const presenceTransport: PresenceTransport = {
    open(h) {
      ph = h;
      queueMicrotask(() => h.onSubscribed());
      return { track: (p) => void tracked.push(p), untrack: () => {}, close: () => {} };
    },
  };
  const rt = new RtcV2Runtime(
    { userId: "me", workspaceId: "ws", sessionId: "s1", generation: 1 },
    {
      fetchToken: async (req) => {
        tokens.push(req);
        return { url: "wss://x", token: "t" };
      },
      roomFactory: () => new FakeRoom() as unknown as V2Room,
      capture: {
        createMicrophoneTrack: async () => fakeTrack("microphone"),
        createCameraTrack: async () => fakeTrack("camera"),
        createScreenTracks: async () => [],
      },
      movementTransport,
      presenceTransport,
      refreshMap: () => {},
      onDemandMode: mode,
    },
  );
  rt.setMap({ state: "READY", version: 1, map: null });
  const others = (list: Array<[string, string]>) =>
    ph?.onPresence(
      "sync",
      Object.fromEntries(
        [["me", "PRIVATE:reuniao"] as [string, string], ...list].map(([u, loc]) => [
          u,
          [{ userId: u, sessionId: "s", generation: 1, workspaceId: "ws", joinedAt: "t", mediaLocation: loc }],
        ]),
      ),
    );
  return { rt, tokens, tracked, others };
}

describe("Runtime On Demand (private)", () => {
  it("9. sozinho não pede token nem cria Room; UI aguardando", async () => {
    const h = runtime("private");
    h.rt.start();
    h.rt.setSelfPosition(REUNIAO.x, REUNIAO.y);
    await settle(400);
    expect(h.rt.getSnapshot().context).toEqual(P("reuniao"));
    expect(h.tokens.filter((t) => t.context === "PRIVATE_ROOM")).toEqual([]);
    expect(h.rt.getSnapshot().awaitingPeer).toBe(true);
    expect(h.tracked.at(-1)?.mediaLocation).toBe("PRIVATE:reuniao");
    for (const p of h.tracked) expect(Object.keys(p)).not.toContain("x");
    await h.rt.dispose();
  });

  it("2 + 8. segundo participante conecta via RoomManager (único connect)", async () => {
    const connectSpy = vi.spyOn(LiveKitRoomManager.prototype, "setDesiredContext");
    const h = runtime("private");
    h.rt.start();
    h.rt.setSelfPosition(REUNIAO.x, REUNIAO.y);
    await settle(400);
    h.others([["u2", "PRIVATE:reuniao"]]);
    await settle(50);
    expect(h.rt.getSnapshot().roomStatus).toBe("CONNECTED");
    expect(h.rt.getSnapshot().room.connected).toEqual(P("reuniao"));
    expect(connectSpy).toHaveBeenCalled();
    expect(FakeRoom.all.at(-1)!.connects).toBe(1);
    connectSpy.mockRestore();
    await h.rt.dispose();
  });

  it("19/20. screen share para quando grace expira e não religa", async () => {
    const h = runtime("private");
    h.rt.start();
    h.rt.setSelfPosition(REUNIAO.x, REUNIAO.y);
    await settle(400);
    h.others([["u2", "PRIVATE:reuniao"]]);
    await settle(50);
    const stop = vi.spyOn(h.rt.local, "detachRoom");
    h.others([]);
    await settle(14_000);
    expect(h.rt.getSnapshot().roomStatus).toBe("CONNECTED");
    await settle(2_000);
    expect(h.rt.getSnapshot().roomStatus).toBe("DISCONNECTED");
    expect(stop).toHaveBeenCalled(); // detachRoom encerra screen share
    expect(h.rt.getSnapshot().local.screenShare.status).toBe("off");
    await h.rt.dispose();
  });

  it("13. gravação ativa mantém a Room sozinho", async () => {
    const h = runtime("private");
    h.rt.start();
    h.rt.setSelfPosition(REUNIAO.x, REUNIAO.y);
    await settle(400);
    h.others([["u2", "PRIVATE:reuniao"]]);
    await settle(50);
    h.rt.setRecordingActive(true);
    h.others([]);
    await settle(60_000);
    expect(h.rt.getSnapshot().roomStatus).toBe("CONNECTED");
    await h.rt.dispose();
  });

  it("lobby inalterado em private", async () => {
    const h = runtime("private");
    h.rt.start();
    h.rt.setSelfPosition(LOBBY.x, LOBBY.y);
    await settle(400);
    expect(h.rt.getSnapshot().room.connected).toEqual({ kind: "LOBBY" });
    await h.rt.dispose();
  });
});

describe("Runtime On Demand (off)", () => {
  it("22. off conecta sozinho na private como antes, sem mediaLocation", async () => {
    const h = runtime("off");
    h.rt.start();
    h.rt.setSelfPosition(REUNIAO.x, REUNIAO.y);
    await settle(400);
    expect(h.rt.getSnapshot().room.connected).toEqual(P("reuniao"));
    expect(h.rt.getSnapshot().awaitingPeer).toBe(false);
    for (const p of h.tracked) expect(p.mediaLocation).toBeUndefined();
    await h.rt.dispose();
  });
});

// ─── Wake vindo só do Presence (dois clientes) ─────────────────

describe("Wake de sala idle exclusivamente via Presence", () => {
  it("A sozinha (NONE, sem Room) → B entra → ambos PRIVATE(X) e só então conectam", async () => {
    FakeRoom.all = [];
    const state: Record<string, PresencePayload[]> = {};
    const subs: Array<Parameters<PresenceTransport["open"]>[0]> = [];
    const bus = (uid: string): PresenceTransport => ({
      open(h) {
        subs.push(h);
        queueMicrotask(() => h.onSubscribed());
        return {
          track: (p) => {
            state[uid] = [p as PresencePayload];
            const snap = { ...state };
            for (const s of subs) queueMicrotask(() => s.onPresence("sync", snap));
          },
          untrack: () => {},
          close: () => {},
        };
      },
    });
    const tokens: Record<string, TokenV2Request[]> = { a: [], b: [] };
    const rooms: Record<string, FakeRoom[]> = { a: [], b: [] };
    const mk = (uid: "a" | "b") => {
      const rt = new RtcV2Runtime(
        { userId: uid, workspaceId: "ws", sessionId: uid, generation: 1 },
        {
          fetchToken: async (req) => {
            tokens[uid].push(req);
            return { url: "wss://x", token: "t" };
          },
          roomFactory: () => {
            const r = new FakeRoom();
            rooms[uid].push(r);
            return r as unknown as V2Room;
          },
          capture: {
            createMicrophoneTrack: async () => fakeTrack("microphone"),
            createCameraTrack: async () => fakeTrack("camera"),
            createScreenTracks: async () => [],
          },
          movementTransport: {
            open(h) {
              queueMicrotask(() => h.onSubscribed(false));
              return { send: () => {}, close: () => {} };
            },
          },
          presenceTransport: bus(uid),
          refreshMap: () => {},
          onDemandMode: "private",
        },
      );
      rt.setMap({ state: "READY", version: 1, map: null });
      return rt;
    };

    const A = mk("a");
    A.start();
    A.setSelfPosition(REUNIAO.x, REUNIAO.y);
    await settle(400);
    expect(A.getSnapshot().context).toEqual(P("reuniao"));
    expect(A.getSnapshot().demand).toEqual({ kind: "NONE" });
    // Nenhuma Room ativa para A (uma Room de lobby transitória antes da zona confirmar é o comportamento atual).
    expect(A.getSnapshot().room.connected).toBeNull();
    expect(A.getSnapshot().roomStatus).toBe("DISCONNECTED");
    const aRoomsBefore = rooms.a.length;
    expect(tokens.a.filter((t) => t.context === "PRIVATE_ROOM")).toEqual([]);

    const B = mk("b");
    B.start();
    B.setSelfPosition(REUNIAO.x, REUNIAO.y);
    await settle(400);

    // Nenhum evento LiveKit (remoteParticipants vazio): só Presence acordou a sala.
    for (const rt of [A, B]) {
      expect(rt.getSnapshot().demand).toEqual({ kind: "PRIVATE", zoneId: "reuniao" });
      expect(rt.getSnapshot().roomStatus).toBe("CONNECTED");
      expect(rt.getSnapshot().room.connected).toEqual(P("reuniao"));
      expect(rt.getSnapshot().remote.participants.length).toBe(0);
    }
    expect(rooms.a.length).toBe(aRoomsBefore + 1);
    expect(tokens.a.filter((t) => t.context === "PRIVATE_ROOM").length).toBe(1);
    expect(tokens.b.filter((t) => t.context === "PRIVATE_ROOM").length).toBe(1);
    await A.dispose();
    await B.dispose();
  });
});

// ─── Cliente parado reage a Presence remoto (semântica Phoenix) ──

describe("Cliente parado reage só ao Presence remoto", () => {
  /**
   * Bus no estilo Phoenix: track() de uma chave ACRESCENTA o meta novo ao fim
   * e só depois remove o antigo (diff de join antes do leave). O cliente
   * remoto pode observar, por um instante ou de forma persistente (meta
   * duplicado de outra aba/conexão), dois metas com a mesma generation.
   */
  function phoenixBus(keepStale: boolean) {
    const state: Record<string, PresencePayload[]> = {};
    const subs: Array<Parameters<PresenceTransport["open"]>[0]> = [];
    const broadcast = () => {
      const snap = Object.fromEntries(Object.entries(state).map(([k, v]) => [k, [...v]]));
      for (const s of subs) queueMicrotask(() => s.onPresence("sync", snap));
    };
    const transport = (uid: string): PresenceTransport => ({
      open(h) {
        subs.push(h);
        queueMicrotask(() => h.onSubscribed());
        return {
          track: (p) => {
            const prev = state[uid] ?? [];
            state[uid] = keepStale ? [...prev.slice(-1), p as PresencePayload] : [p as PresencePayload];
            broadcast();
          },
          untrack: () => {
            delete state[uid];
            broadcast();
          },
          close: () => {},
        };
      },
    });
    return { transport };
  }

  function mk(uid: string, presenceTransport: PresenceTransport) {
    const tokens: TokenV2Request[] = [];
    const rt = new RtcV2Runtime(
      { userId: uid, workspaceId: "ws", sessionId: uid, generation: 1 },
      {
        fetchToken: async (req) => {
          tokens.push(req);
          return { url: "wss://x", token: "t" };
        },
        roomFactory: () => new FakeRoom() as unknown as V2Room,
        capture: {
          createMicrophoneTrack: async () => fakeTrack("microphone"),
          createCameraTrack: async () => fakeTrack("camera"),
          createScreenTracks: async () => [],
        },
        movementTransport: {
          open(h) {
            queueMicrotask(() => h.onSubscribed(false));
            return { send: () => {}, close: () => {} };
          },
        },
        presenceTransport,
        refreshMap: () => {},
        onDemandMode: "private",
        soloGraceMs: 15_000,
      },
    );
    rt.setMap({ state: "READY", version: 1, map: null });
    return { rt, tokens };
  }

  it("A parado em PRIVATE(X); B entra (meta obsoleto antes do novo) → A recalcula 2 e vai a PRIVATE", async () => {
    const bus = phoenixBus(true);
    const A = mk("a", bus.transport("a"));
    A.rt.start();
    A.rt.setSelfPosition(REUNIAO.x, REUNIAO.y);
    await settle(400);
    expect(A.rt.getSnapshot().demand).toEqual({ kind: "NONE" });

    // B entra no LOBBY e depois na sala: o Presence de B passa a ter
    // [LOBBY (obsoleto), PRIVATE:reuniao (novo)] com a mesma generation.
    const B = mk("b", bus.transport("b"));
    B.rt.start();
    B.rt.setSelfPosition(LOBBY.x, LOBBY.y);
    await settle(400);
    B.rt.setSelfPosition(REUNIAO.x, REUNIAO.y);
    await settle(400);

    // A não se moveu: só o Presence remoto mudou.
    expect(A.rt.getSnapshot().demand).toEqual({ kind: "PRIVATE", zoneId: "reuniao" });
    expect(B.rt.getSnapshot().demand).toEqual({ kind: "PRIVATE", zoneId: "reuniao" });
    expect(A.tokens.filter((t) => t.context === "PRIVATE_ROOM").length).toBe(1);
    await A.rt.dispose();
    await B.rt.dispose();
  });

  it("A e B em PRIVATE(X); B sai → A parado arma grace e após 15s vai a NONE", async () => {
    const bus = phoenixBus(true);
    const A = mk("a", bus.transport("a"));
    const B = mk("b", bus.transport("b"));
    A.rt.start();
    B.rt.start();
    A.rt.setSelfPosition(REUNIAO.x, REUNIAO.y);
    B.rt.setSelfPosition(REUNIAO.x, REUNIAO.y);
    await settle(400);
    expect(A.rt.getSnapshot().demand).toEqual({ kind: "PRIVATE", zoneId: "reuniao" });

    B.rt.setSelfPosition(LOBBY.x, LOBBY.y);
    await settle(400);
    expect(A.rt.demand.isGraceArmed()).toBe(true);
    expect(A.rt.getSnapshot().demand.kind).toBe("PRIVATE");
    await settle(15_000);
    expect(A.rt.getSnapshot().demand).toEqual({ kind: "NONE" });
    await A.rt.dispose();
    await B.rt.dispose();
  });

  it("track do próprio mediaLocation sem mudança real não dispara nova reavaliação em loop", async () => {
    const bus = phoenixBus(false);
    const A = mk("a", bus.transport("a"));
    A.rt.start();
    A.rt.setSelfPosition(REUNIAO.x, REUNIAO.y);
    await settle(400);
    const rev = A.rt.presence.revision;
    await settle(2000);
    expect(A.rt.presence.revision).toBe(rev);
    await A.rt.dispose();
  });
});
