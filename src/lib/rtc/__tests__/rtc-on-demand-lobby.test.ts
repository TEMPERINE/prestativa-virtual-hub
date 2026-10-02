/**
 * RTC On Demand — Fase 2 (lobby/corredor) + hardening do Presence + mic salvo.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RtcDemandController, parseRtcOnDemand, type DemandInput } from "../rtc-demand-controller";
import { RtcV2Runtime, type TokenV2Request, type V2Room } from "../rtc-v2-runtime";
import type { MovementEvent, MovementTransport } from "../movement-realtime";
import {
  OfficePresence,
  presenceMetaWins,
  type PresencePayload,
  type PresenceTransport,
} from "../office-presence";
import type { LocalTrackLike } from "../local-media";
import {
  CONNECT_RADIUS,
  DISCONNECT_RADIUS,
  SpatialSubscriptions,
  computeNearby,
  withinSpatialRange,
} from "../spatial-subscriptions";
import {
  loadMicPreference,
  micPreferenceKey,
  reconcileAcquiredMic,
  saveMicPreference,
  type KeyValueStore,
} from "../mic-preference";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const settle = async (ms = 0) => {
  await vi.advanceTimersByTimeAsync(ms);
  for (let i = 0; i < 30; i++) await Promise.resolve();
  await vi.advanceTimersByTimeAsync(0);
};

const Y = 0.42;
const L = (x: number) => ({ x, y: Y }); // pontos de corredor (sem zona)
const REUNIAO = { x: 0.8, y: 0.2 };

// ─── controlador puro ─────────────────────────────────────────

function ctl(mode: "off" | "private" | "all" = "all") {
  const events: string[] = [];
  const c = new RtcDemandController({
    mode,
    graceMs: 15_000,
    lobbyGraceMs: 15_000,
    telemetry: { record: (t) => void events.push(t) },
  });
  const up = (p: Partial<DemandInput>) =>
    c.update({
      context: { kind: "LOBBY" },
      occupants: 1,
      recordingActive: false,
      roomStatus: null,
      nearbyLobbyPeers: 0,
      contextStable: true,
      ...p,
    });
  return { c, up, events };
}

describe("flag", () => {
  it("34. all ativa Fase 2 (sem fallback para private)", () => {
    expect(parseRtcOnDemand("all")).toBe("all");
    expect(parseRtcOnDemand("private")).toBe("private");
    expect(parseRtcOnDemand(undefined)).toBe("off");
  });
});

describe("RtcDemandController (all)", () => {
  it("1. lobby sozinho => NONE", () => {
    const { c, up } = ctl();
    up({});
    expect(c.getDemand()).toEqual({ kind: "NONE" });
  });
  it("3. peer no raio => LOBBY", () => {
    const { c, up, events } = ctl();
    up({ nearbyLobbyPeers: 1 });
    expect(c.getDemand()).toEqual({ kind: "LOBBY" });
    expect(events).toContain("RTC_LOBBY_DEMAND_CHANGED");
  });
  it("10/11/12. afastar arma grace; retorno cancela; expira => NONE", () => {
    const { c, up, events } = ctl();
    up({ nearbyLobbyPeers: 1 });
    up({ nearbyLobbyPeers: 0 });
    expect(c.isLobbyGraceArmed()).toBe(true);
    expect(c.getDemand().kind).toBe("LOBBY");
    vi.advanceTimersByTime(10_000);
    up({ nearbyLobbyPeers: 1 });
    expect(c.isLobbyGraceArmed()).toBe(false);
    up({ nearbyLobbyPeers: 0 });
    vi.advanceTimersByTime(15_000);
    expect(c.getDemand()).toEqual({ kind: "NONE" });
    for (const e of [
      "RTC_LOBBY_GRACE_ARMED",
      "RTC_LOBBY_GRACE_CANCELLED",
      "RTC_LOBBY_GRACE_EXPIRED",
    ])
      expect(events).toContain(e);
  });
  it("classificação inicial instável nunca conecta lobby", () => {
    const { c, up } = ctl();
    up({ nearbyLobbyPeers: 3, contextStable: false });
    expect(c.getDemand()).toEqual({ kind: "NONE" });
  });
  it("31. RECONNECTING adia expiração do grace do lobby", () => {
    const { c, up } = ctl();
    up({ nearbyLobbyPeers: 1, roomStatus: "CONNECTED" });
    up({ nearbyLobbyPeers: 0, roomStatus: "RECONNECTING" });
    vi.advanceTimersByTime(45_000);
    expect(c.getDemand().kind).toBe("LOBBY");
  });
  it("33. private: lobby segue conectado como antes", () => {
    const { c, up } = ctl("private");
    up({});
    expect(c.getDemand()).toEqual({ kind: "LOBBY" });
  });
  it("Fase 1 intacta em all: private sozinho NONE, 2 => PRIVATE", () => {
    const { c, up } = ctl();
    up({ context: { kind: "PRIVATE_ROOM", zoneId: "A" } });
    expect(c.getDemand().kind).toBe("NONE");
    up({ context: { kind: "PRIVATE_ROOM", zoneId: "A" }, occupants: 2 });
    expect(c.getDemand()).toEqual({ kind: "PRIVATE", zoneId: "A" });
  });
});

describe("critério espacial compartilhado", () => {
  it("9. histerese: entre CONNECT e DISCONNECT não oscila", () => {
    const mid = (CONNECT_RADIUS + DISCONNECT_RADIUS) / 2;
    expect(withinSpatialRange(mid, false)).toBe(false);
    expect(withinSpatialRange(mid, true)).toBe(true);
    expect(withinSpatialRange(DISCONNECT_RADIUS + 0.001, true)).toBe(false);
  });
  it("14. grupos separados: A só vê B", () => {
    const near = computeNearby(
      L(0.5),
      [
        ["B", L(0.52)],
        ["C", L(0.7)],
        ["D", L(0.72)],
      ],
      new Set(),
    );
    expect([...near]).toEqual(["B"]);
  });
  it("8. SpatialSubscriptions usa o mesmo critério (único dono de setSubscribed)", () => {
    const calls: boolean[] = [];
    const pub = { trackSid: "t", setSubscribed: (v: boolean) => void calls.push(v) };
    const room = {
      remoteParticipants: new Map([
        ["B", { identity: "B", trackPublications: new Map([["t", pub]]) }],
      ]),
      on: () => {},
      off: () => {},
    };
    const s = new SpatialSubscriptions();
    s.attachRoom(room, { kind: "LOBBY" });
    s.setLocalPosition(L(0.5));
    s.setRemotePosition("B", L(0.5 + CONNECT_RADIUS - 0.001));
    s.setRemotePosition("B", L(0.5 + (CONNECT_RADIUS + DISCONNECT_RADIUS) / 2));
    expect(calls).toEqual([true]);
  });
});

// ─── mundo simulado (Presence + Movement compartilhados) ───────

class FakeRoom {
  static all: FakeRoom[] = [];
  remoteParticipants = new Map();
  connects: Array<{ autoSubscribe: boolean }> = [];
  constructor() {
    FakeRoom.all.push(this);
  }
  async connect(_u: string, _t: string, opts: { autoSubscribe: boolean }) {
    this.connects.push(opts);
  }
  async disconnect() {}
  on() {}
  off() {}
  async publishTrack() {}
  async unpublishTrack() {}
}

function fakeTrack(source: "microphone" | "camera") {
  const t = { source, stopped: false, stop: () => void (t.stopped = true), onEnded: () => () => {} };
  return t as unknown as LocalTrackLike;
}

function world(mode: "off" | "private" | "all" = "all") {
  FakeRoom.all = [];
  const presence: Record<string, PresencePayload[]> = {};
  const psubs: Array<Parameters<PresenceTransport["open"]>[0]> = [];
  const msubs: Array<{ uid: string; h: Parameters<MovementTransport["open"]>[0] }> = [];
  const pBroadcast = () => {
    const snap = Object.fromEntries(Object.entries(presence).map(([k, v]) => [k, [...v]]));
    for (const s of psubs) queueMicrotask(() => s.onPresence("sync", snap));
  };
  const clients: Record<string, { rt: RtcV2Runtime; tokens: TokenV2Request[] }> = {};
  const add = (uid: string) => {
    const tokens: TokenV2Request[] = [];
    const rt = new RtcV2Runtime(
      { userId: uid, workspaceId: "ws", sessionId: uid, generation: 1 },
      {
        fetchToken: async (req) => {
          tokens.push(req);
          return { url: "wss://x", token: "t", roomName: "prestativa-office:ws:lobby" };
        },
        roomFactory: () => new FakeRoom() as unknown as V2Room,
        capture: {
          createMicrophoneTrack: async () => fakeTrack("microphone"),
          createCameraTrack: async () => fakeTrack("camera"),
          createScreenTracks: async () => [],
        },
        movementTransport: {
          open(h) {
            const me = { uid, h };
            msubs.push(me);
            queueMicrotask(() => h.onSubscribed(false));
            return {
              send: (e: MovementEvent) => {
                for (const s of msubs)
                  if (s !== me) queueMicrotask(() => s.h.onEvent({ ...e }));
              },
              close: () => void msubs.splice(msubs.indexOf(me), 1),
            };
          },
        },
        presenceTransport: {
          open(h) {
            psubs.push(h);
            queueMicrotask(() => h.onSubscribed());
            return {
              track: (p) => {
                presence[uid] = [p as PresencePayload];
                pBroadcast();
              },
              untrack: () => {
                delete presence[uid];
                pBroadcast();
              },
              close: () => void psubs.splice(psubs.indexOf(h), 1),
            };
          },
        },
        refreshMap: () => {},
        onDemandMode: mode,
        soloGraceMs: 15_000,
        lobbyGraceMs: 15_000,
      },
    );
    rt.setMap({ state: "READY", version: 1, map: null });
    clients[uid] = { rt, tokens };
    return clients[uid];
  };
  const enter = async (uid: string, pos: { x: number; y: number }) => {
    const c = add(uid);
    c.rt.start();
    c.rt.setSelfPosition(pos.x, pos.y);
    await settle(400);
    return c;
  };
  const move = async (uid: string, pos: { x: number; y: number }, ms = 400) => {
    clients[uid].rt.announceJump(pos.x, pos.y);
    await settle(ms);
  };
  const demand = (uid: string) => clients[uid].rt.getSnapshot().demand.kind;
  const lobbyTokens = (uid: string) =>
    clients[uid].tokens.filter((t) => t.context === "LOBBY").length;
  const disposeAll = () => Promise.all(Object.values(clients).map((c) => c.rt.dispose()));
  return { enter, move, demand, lobbyTokens, clients, disposeAll };
}

describe("Runtime Lobby On Demand (all)", () => {
  it("1/19. abertura no lobby sozinho: NONE, sem token, UI neutra", async () => {
    const w = world();
    const a = await w.enter("A", L(0.5));
    expect(w.demand("A")).toBe("NONE");
    expect(w.lobbyTokens("A")).toBe(0);
    expect(a.rt.getSnapshot().lobbyIdle).toBe(true);
    expect(FakeRoom.all).toHaveLength(0);
    await w.disposeAll();
  });

  it("2. dois usuários longe => ambos NONE", async () => {
    const w = world();
    await w.enter("A", L(0.4));
    await w.enter("B", L(0.6));
    await settle(100);
    expect([w.demand("A"), w.demand("B")]).toEqual(["NONE", "NONE"]);
    expect(FakeRoom.all).toHaveLength(0);
    await w.disposeAll();
  });

  it("3/4/5/6/7. B se aproxima: A parado acorda; ambos na mesma lobby Room, autoSubscribe=false", async () => {
    const w = world();
    await w.enter("A", L(0.5));
    await w.enter("B", L(0.6));
    await w.move("B", L(0.52));
    expect([w.demand("A"), w.demand("B")]).toEqual(["LOBBY", "LOBBY"]);
    expect(w.lobbyTokens("A")).toBe(1);
    expect(w.lobbyTokens("B")).toBe(1);
    expect(FakeRoom.all).toHaveLength(2); // uma Room por cliente, mesma lobby
    for (const r of FakeRoom.all) expect(r.connects).toEqual([{ autoSubscribe: false }]);
    await w.disposeAll();
  });

  it("17. snapshot inicial encontra usuário parado próximo", async () => {
    const w = world();
    await w.enter("A", L(0.5));
    await w.enter("B", L(0.51));
    await settle(100);
    expect([w.demand("A"), w.demand("B")]).toEqual(["LOBBY", "LOBBY"]);
    await w.disposeAll();
  });

  it("9/10/11/12. histerese, grace, retorno cancela e expiração => NONE", async () => {
    const w = world();
    await w.enter("A", L(0.5));
    await w.enter("B", L(0.52));
    await w.move("B", L(0.5 + (CONNECT_RADIUS + DISCONNECT_RADIUS) / 2));
    expect(w.clients.A.rt.demand.isLobbyGraceArmed()).toBe(false);
    await w.move("B", L(0.6));
    expect(w.clients.A.rt.demand.isLobbyGraceArmed()).toBe(true);
    expect(w.demand("A")).toBe("LOBBY");
    await w.move("B", L(0.52), 5_000);
    expect(w.clients.A.rt.demand.isLobbyGraceArmed()).toBe(false);
    await w.move("B", L(0.6));
    await settle(15_500);
    expect([w.demand("A"), w.demand("B")]).toEqual(["NONE", "NONE"]);
    expect(w.clients.A.rt.getSnapshot().roomStatus).toBe("DISCONNECTED");
    await w.disposeAll();
  });

  it("13. B sai (logout) e A parado arma grace", async () => {
    const w = world();
    await w.enter("A", L(0.5));
    await w.enter("B", L(0.52));
    await w.clients.B.rt.dispose();
    await settle(50);
    expect(w.clients.A.rt.demand.isLobbyGraceArmed()).toBe(true);
    await settle(15_500);
    expect(w.demand("A")).toBe("NONE");
    await w.disposeAll();
  });

  it("14/15/16. grupos A/B e C/D, E sozinho; terceiro chega sem derrubar", async () => {
    const w = world();
    await w.enter("A", L(0.3));
    await w.enter("B", L(0.32));
    await w.enter("C", L(0.6));
    await w.enter("D", L(0.62));
    await w.enter("E", L(0.9));
    await settle(100);
    expect(["A", "B", "C", "D", "E"].map(w.demand)).toEqual([
      "LOBBY",
      "LOBBY",
      "LOBBY",
      "LOBBY",
      "NONE",
    ]);
    await w.move("E", L(0.34));
    expect(w.demand("E")).toBe("LOBBY");
    expect(w.lobbyTokens("A")).toBe(1);
    expect(w.lobbyTokens("B")).toBe(1);
    await w.disposeAll();
  });

  it("18. abertura dentro de Private não cria lobby transitório", async () => {
    const w = world();
    await w.enter("X", L(0.5)); // alguém no corredor não interfere
    await w.enter("A", REUNIAO);
    expect(w.lobbyTokens("A")).toBe(0);
    expect(w.demand("A")).toBe("NONE");
    await w.disposeAll();
  });

  it("20/21. lobby -> private sozinho NONE; com ocupante PRIVATE; nunca duas Rooms", async () => {
    const w = world();
    await w.enter("A", L(0.5));
    await w.enter("B", L(0.52));
    await w.move("A", REUNIAO);
    expect(w.demand("A")).toBe("NONE");
    expect(w.clients.A.rt.getSnapshot().room.connected).toBeNull();
    await w.move("B", REUNIAO);
    expect([w.demand("A"), w.demand("B")]).toEqual(["PRIVATE", "PRIVATE"]);
    await w.disposeAll();
  });

  it("22/23. private -> lobby: sozinho NONE; com peer próximo LOBBY", async () => {
    const w = world();
    await w.enter("A", REUNIAO);
    await w.move("A", L(0.5));
    expect(w.demand("A")).toBe("NONE");
    expect(w.lobbyTokens("A")).toBe(0);
    await w.enter("B", L(0.7));
    await w.move("B", L(0.52));
    expect(w.demand("A")).toBe("LOBBY");
    await w.disposeAll();
  });

  it("5x corredor <-> sala: nunca duas Rooms conectadas ao mesmo tempo", async () => {
    const w = world();
    await w.enter("A", L(0.5));
    await w.enter("B", L(0.52));
    for (let i = 0; i < 5; i++) {
      await w.move("A", REUNIAO);
      await w.move("A", L(0.5));
      const s = w.clients.A.rt.getSnapshot();
      expect(s.demand.kind).toBe("LOBBY");
      expect(s.room.connected?.kind ?? "LOBBY").toBe("LOBBY");
    }
    await w.disposeAll();
  });

  it("24/25. intents sobrevivem ao idle e captura física para em NONE", async () => {
    const w = world();
    await w.enter("A", L(0.5));
    await w.enter("B", L(0.52));
    await w.clients.A.rt.toggleMic();
    await settle(50);
    expect(w.clients.A.rt.getSnapshot().local.microphone.status).toBe("on");
    await w.move("B", L(0.7));
    await settle(15_500);
    const s = w.clients.A.rt.getSnapshot();
    expect(s.demand.kind).toBe("NONE");
    expect(s.local.microphone.intent).toBe(true);
    expect(s.local.captureSuspended).toBe(true);
    await w.disposeAll();
  });

  it("32. off mantém lobby conectado sozinho", async () => {
    const w = world("off");
    await w.enter("A", L(0.5));
    expect(w.clients.A.rt.getSnapshot().room.connected).toEqual({ kind: "LOBBY" });
    await w.disposeAll();
  });
});

// ─── Presence revision ─────────────────────────────────────────

describe("presenceRevision", () => {
  const m = (gen: number, rev?: number, loc?: string): PresencePayload => ({
    userId: "u",
    sessionId: "s",
    generation: gen,
    workspaceId: "w",
    joinedAt: "t",
    ...(rev != null ? { presenceRevision: rev } : {}),
    ...(loc ? { mediaLocation: loc } : {}),
  });
  it("generation > revision > ordem (fallback)", () => {
    expect(presenceMetaWins(m(2, 1), m(1, 9))).toBe(true);
    expect(presenceMetaWins(m(1, 2), m(1, 5))).toBe(false);
    expect(presenceMetaWins(m(1, 5), m(1, 2))).toBe(true);
    expect(presenceMetaWins(m(1), m(1))).toBe(true);
    expect(presenceMetaWins(m(1), m(1, 3))).toBe(false);
  });
  it("escolha determinística independente da ordem do array", () => {
    let h: Parameters<PresenceTransport["open"]>[0] | null = null;
    const p = new OfficePresence({
      self: { userId: "me", sessionId: "s", generation: 1, workspaceId: "w" },
      transport: {
        open: (x) => ((h = x), { track: () => {}, untrack: () => {}, close: () => {} }),
      },
    });
    p.start();
    const newer = m(1, 4, "PRIVATE:x");
    const older = m(1, 2, "LOBBY");
    h!.onPresence("sync", { u: [newer, older] });
    expect(p.getRoster().get("u")?.mediaLocation).toBe("PRIVATE:x");
    h!.onPresence("sync", { u: [older, newer] });
    expect(p.getRoster().get("u")?.mediaLocation).toBe("PRIVATE:x");
  });
  it("começa em 1 e só incrementa quando mediaLocation muda", () => {
    const tracks: PresencePayload[] = [];
    let h: Parameters<PresenceTransport["open"]>[0] | null = null;
    const p = new OfficePresence({
      self: { userId: "me", sessionId: "s", generation: 1, workspaceId: "w" },
      transport: {
        open: (x) => (
          (h = x),
          { track: (pl) => void tracks.push({ ...pl }), untrack: () => {}, close: () => {} }
        ),
      },
    });
    p.start();
    h!.onSubscribed();
    expect(tracks[0].presenceRevision).toBe(1);
    p.setMediaLocation("LOBBY");
    p.setMediaLocation("LOBBY");
    p.setMediaLocation("PRIVATE:a");
    expect(tracks.map((t) => t.presenceRevision)).toEqual([1, 2, 3]);
    expect(vi.getTimerCount()).toBe(0);
  });
});

// ─── Último microfone ─────────────────────────────────────────

function memStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

describe("preferência do microfone", () => {
  it("26. guarda e recupera só o deviceId, por usuário", () => {
    const s = memStore();
    saveMicPreference("u1", "mic-usb", s);
    expect(loadMicPreference("u1", s)).toBe("mic-usb");
    expect(loadMicPreference("u2", s)).toBeNull();
    expect([...s.data.keys()]).toEqual([micPreferenceKey("u1")]);
    expect([...s.data.values()].join()).not.toMatch(/on|true/i);
  });
  it("27. mic salvo sumiu: preferência passa a ser o que realmente funcionou", () => {
    const s = memStore();
    saveMicPreference("u1", "gone", s);
    expect(reconcileAcquiredMic("u1", "gone", "builtin", s)).toBe("builtin");
    expect(loadMicPreference("u1", s)).toBe("builtin");
    // sem informação do device: mantém preferência
    expect(reconcileAcquiredMic("u1", "builtin", null, s)).toBe("builtin");
  });
  it("28. novo login continua mic OFF (preferência não guarda intent)", async () => {
    const w = world();
    const a = await w.enter("A", L(0.5));
    expect(a.rt.getSnapshot().local.microphone.intent).toBe(false);
    await w.disposeAll();
  });
});
