/**
 * RTC v2 — Etapa 12: runtime (orquestração, sem React).
 *
 * Coordena os módulos já existentes; não reimplementa a lógica deles:
 *   sessão ACTIVE (vinda da rota) → MediaContext → LiveKitRoomManager
 *   → LocalMedia / RemoteMedia / SpatialSubscriptions (somente LOBBY)
 *   + MovementRealtime + OfficePresence + RtcTelemetry.
 *
 * Invariantes:
 *  - não faz claim de sessão (usa a sessão ACTIVE já existente);
 *  - contexto derivado só de sessão + posição própria + mapa canônico/versão;
 *  - PRIVATE_ROOM: roster = room.remoteParticipants (RemoteMedia), autoSubscribe;
 *    nada de peers desejados legados, visibilidade de vídeo ou posição de terceiros;
 *  - LOBBY: SpatialSubscriptions decide setSubscribed com posições do Movement V2;
 *  - MAP_VERSION_STALE: MAP_STALE → recarrega mapa → espera READY → recalcula
 *    contexto → UMA nova reconciliação; stale de novo = erro recuperável.
 */
import type { MapOverrides } from "@/lib/map-overrides";
import type { MapSyncState } from "@/lib/map-sync";
import { meetingZoneAtPoint } from "./canonical-zones";
import {
  LiveKitRoomManager,
  type RoomLike,
  type RoomManagerSnapshot,
} from "./livekit-room-manager";
import {
  LocalMedia,
  type CaptureAdapter,
  type LocalMediaSnapshot,
  type PublishTargetLike,
} from "./local-media";
import { MediaContextController, type MediaContext, type TimerApi } from "./media-context";
import {
  MovementRealtime,
  type MovementTransport,
  type RemoteAvatarState,
} from "./movement-realtime";
import { OfficePresence, type PresencePayload, type PresenceTransport } from "./office-presence";
import { RemoteMedia, type RemoteMediaSnapshot, type RemoteRoomLike } from "./remote-media";
import { RtcTelemetry, type TelemetryAdapter } from "./rtc-telemetry";
import { isMapVersionStaleError } from "./rtc-telemetry-types";
import { SpatialSubscriptions, type SpatialRoomLike } from "./spatial-subscriptions";

/** Room composta usada pelo V2 (uma única Room LiveKit por trás). */
export interface V2Room extends RoomLike, PublishTargetLike {
  readonly remoteParticipants: RemoteRoomLike["remoteParticipants"] &
    SpatialRoomLike["remoteParticipants"];
  on(event: string, fn: (...args: unknown[]) => void): void;
  off(event: string, fn: (...args: unknown[]) => void): void;
  setAudioOutput?(deviceId: string): Promise<void>;
}

export interface RtcV2Config {
  userId: string;
  workspaceId: string;
  sessionId: string;
  generation: number;
}

export type TokenV2Request =
  | {
      context: "LOBBY";
      workspaceId: string;
      sessionId: string;
      generation: number;
      mapVersion: number;
    }
  | {
      context: "PRIVATE_ROOM";
      workspaceId: string;
      sessionId: string;
      generation: number;
      mapVersion: number;
      zoneId: string;
    };

export interface RtcV2Deps {
  fetchToken: (req: TokenV2Request) => Promise<{ url: string; token: string; roomName?: string }>;
  roomFactory: () => V2Room;
  capture: CaptureAdapter;
  movementTransport: MovementTransport;
  presenceTransport: PresenceTransport;
  telemetryAdapter?: TelemetryAdapter;
  /** Pede recarga do mapa canônico (MAP_VERSION_STALE). */
  refreshMap: () => void;
  timers?: TimerApi;
  /** Parada automática do movimento quando nenhuma amostra chega. */
  motionIdleMs?: number;
}

export interface RtcV2Snapshot {
  roomStatus: RoomManagerSnapshot["status"];
  roomName: string | null;
  error: string | null;
  context: MediaContext;
  local: LocalMediaSnapshot;
  remote: RemoteMediaSnapshot;
  /** userIds com mídia autorizada: PRIVATE_ROOM = todos da Room; LOBBY = em alcance. */
  mediaPeers: string[];
  speaking: Record<string, boolean>;
  selfSpeaking: boolean;
  avatars: ReadonlyMap<string, RemoteAvatarState>;
  online: ReadonlyMap<string, PresencePayload>;
  disposed: boolean;
}

export const MOTION_IDLE_MS = 150;

const defaultTimers: TimerApi = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (h) => globalThis.clearTimeout(h as ReturnType<typeof setTimeout>),
};

export class RtcV2Runtime {
  readonly telemetry: RtcTelemetry | null;
  readonly context: MediaContextController;
  readonly rooms: LiveKitRoomManager;
  readonly local: LocalMedia;
  readonly remote: RemoteMedia;
  readonly spatial: SpatialSubscriptions;
  readonly movement: MovementRealtime;
  readonly presence: OfficePresence;

  private readonly timers: TimerApi;
  private readonly idleMs: number;
  private map: { state: MapSyncState; version: number; map: MapOverrides | null } | null = null;
  private attached: V2Room | null = null;
  private speakHandler: ((...a: unknown[]) => void) | null = null;
  private speaking: Record<string, boolean> = {};
  private selfSpeaking = false;
  private staleRetryUsed = false;
  private staleAwaitingMap = false;
  private started = false;
  private movementStarted = false;
  private disposed = false;
  private selfPos: { x: number; y: number } | null = null;
  private idleTimer: unknown = null;
  private lastInRangeKey = "";
  private snap: RtcV2Snapshot;
  private listeners = new Set<() => void>();
  private unsubs: Array<() => void> = [];

  constructor(
    readonly config: RtcV2Config,
    private readonly deps: RtcV2Deps,
  ) {
    this.timers = deps.timers ?? defaultTimers;
    this.idleMs = deps.motionIdleMs ?? MOTION_IDLE_MS;
    const tel = deps.telemetryAdapter
      ? new RtcTelemetry({
          adapter: deps.telemetryAdapter,
          session: {
            workspaceId: config.workspaceId,
            sessionId: config.sessionId,
            generation: config.generation,
          },
        })
      : null;
    this.telemetry = tel;
    const sink = tel ?? undefined;

    this.context = new MediaContextController({
      resolveZone: (pos) => {
        const id = meetingZoneAtPoint(this.map?.map ?? null, pos);
        return id ? { id, isPrivate: true } : null;
      },
      timers: this.timers,
      telemetry: sink,
    });
    this.rooms = new LiveKitRoomManager({
      tokenProvider: (ctx) => {
        const base = {
          workspaceId: config.workspaceId,
          sessionId: config.sessionId,
          generation: config.generation,
          mapVersion: this.map?.version ?? 0,
        };
        return deps.fetchToken(
          ctx.kind === "PRIVATE_ROOM"
            ? { ...base, context: "PRIVATE_ROOM", zoneId: ctx.zoneId }
            : { ...base, context: "LOBBY" },
        );
      },
      roomFactory: deps.roomFactory,
      telemetry: sink,
    });
    this.local = new LocalMedia(deps.capture, sink);
    this.remote = new RemoteMedia(sink);
    this.spatial = new SpatialSubscriptions();
    this.movement = new MovementRealtime({
      self: { userId: config.userId, sessionId: config.sessionId, generation: config.generation },
      transport: deps.movementTransport,
      telemetry: sink,
    });
    this.presence = new OfficePresence({
      self: {
        userId: config.userId,
        sessionId: config.sessionId,
        generation: config.generation,
        workspaceId: config.workspaceId,
      },
      transport: deps.presenceTransport,
      telemetry: sink,
    });
    this.snap = this.build();
  }

  // ─── ciclo de vida ─────────────────────────────────────────

  start(): void {
    if (this.started || this.disposed) return;
    this.started = true;
    this.unsubs.push(
      this.context.subscribe((s) => this.rooms.setDesiredContext(s.context)),
      this.rooms.subscribe((s) => this.onRooms(s)),
      this.local.subscribe(() => this.emit()),
      this.remote.subscribe(() => this.emit()),
      this.movement.subscribe((states) => {
        for (const [uid, st] of states) this.spatial.setRemotePosition(uid, { x: st.x, y: st.y });
        this.emit();
      }),
      this.presence.subscribe(() => this.onPresence()),
    );
    this.presence.start();
    if (this.selfPos) this.startMovement();
    this.context.setSession("ACTIVE");
    if (this.map) this.context.setMap({ state: this.map.state, version: this.map.version });
  }

  /** Sessão deixou de ser ACTIVE (REPLACED/OFFLINE): converge para OFFLINE. */
  setSessionActive(active: boolean): void {
    if (this.disposed) return;
    this.context.setSession(active ? "ACTIVE" : "REPLACED");
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    if (this.idleTimer != null) this.timers.clearTimeout(this.idleTimer);
    this.idleTimer = null;
    for (const u of this.unsubs) u();
    this.unsubs = [];
    this.detachRoom();
    this.context.dispose();
    await Promise.allSettled([
      this.local.dispose(),
      this.rooms.dispose(),
      this.movement.dispose(),
      this.presence.dispose(),
    ]);
    this.remote.dispose();
    this.spatial.dispose();
    if (this.telemetry) await this.telemetry.dispose();
    this.snap = { ...this.build(), disposed: true };
    for (const l of this.listeners) l();
    this.listeners.clear();
  }

  // ─── entradas ──────────────────────────────────────────────

  setMap(m: { state: MapSyncState; version: number; map: MapOverrides | null }): void {
    if (this.disposed) return;
    this.map = { ...m };
    if (this.started) this.context.setMap({ state: m.state, version: m.version });
    if (this.staleAwaitingMap && m.state === "READY") {
      this.staleAwaitingMap = false;
      // contexto já recalculado acima; agora UMA nova reconciliação.
      if (this.rooms.getSnapshot().status === "ERROR") this.rooms.retry();
    }
  }

  /** Posição própria (qualquer origem: caminhada, teleporte, carga inicial). */
  setSelfPosition(x: number, y: number): void {
    if (this.disposed) return;
    const prev = this.selfPos;
    this.selfPos = { x, y };
    this.context.setSelfPosition({ x, y });
    this.spatial.setLocalPosition({ x, y });
    if (!prev) {
      this.movement.updateLocal(x, y, 0, 0);
      if (this.started) this.startMovement();
    }
    this.emitIfRangeChanged();
  }

  /** Amostra de caminhada (pode vir a 60 FPS). Para sozinho após idleMs sem amostras. */
  reportMotion(x: number, y: number, vx: number, vy: number): void {
    if (this.disposed) return;
    this.setSelfPosition(x, y);
    this.movement.updateLocal(x, y, vx, vy);
    if (this.idleTimer != null) this.timers.clearTimeout(this.idleTimer);
    this.idleTimer = this.timers.setTimeout(() => {
      this.idleTimer = null;
      const p = this.selfPos;
      if (p && !this.disposed) this.movement.updateLocal(p.x, p.y, 0, 0);
    }, this.idleMs);
  }

  /** Salto sem caminhada (teleporte): um único anúncio explícito. */
  announceJump(x: number, y: number): void {
    if (this.disposed) return;
    this.setSelfPosition(x, y);
    this.movement.updateLocal(x, y, 0, 0);
    this.movement.announcePosition();
  }

  toggleMic(): Promise<void> {
    return this.local.setMicrophoneEnabled(!this.local.getSnapshot().microphone.intent);
  }
  toggleCam(): Promise<void> {
    return this.local.setCameraEnabled(!this.local.getSnapshot().camera.intent);
  }
  toggleScreen(): Promise<void> {
    const s = this.local.getSnapshot().screenShare.status;
    return s === "on" || s === "starting"
      ? this.local.stopScreenShare()
      : this.local.startScreenShare();
  }
  retry(): void {
    this.rooms.retry();
  }
  currentRoom(): V2Room | null {
    return this.attached;
  }

  // ─── saída ─────────────────────────────────────────────────

  getSnapshot = (): RtcV2Snapshot => this.snap;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  // ─── internos ──────────────────────────────────────────────

  private startMovement(): void {
    if (this.movementStarted || this.disposed) return;
    this.movementStarted = true;
    this.movement.start();
  }

  private onRooms(s: RoomManagerSnapshot): void {
    const live = s.status === "CONNECTED" || s.status === "RECONNECTING";
    const room = live ? (this.rooms.getActiveRoom() as V2Room | null) : null;
    if (room !== this.attached) {
      this.detachRoom();
      if (room && s.connected) this.attachRoom(room, s.connected);
    }
    if (s.status === "CONNECTED") this.staleRetryUsed = false;
    if (s.status === "ERROR" && isMapVersionStaleError(s.error) && !this.staleRetryUsed) {
      this.staleRetryUsed = true;
      this.staleAwaitingMap = true;
      try {
        this.deps.refreshMap();
      } catch {
        /* a recarga falhar mantém o erro recuperável */
      }
    }
    this.emit();
  }

  private attachRoom(room: V2Room, ctx: MediaContext): void {
    this.attached = room;
    void this.local.attachRoom(room);
    this.remote.attachRoom(room);
    // Spatial só atua em LOBBY; em PRIVATE_ROOM attachRoom apenas desanexa.
    this.spatial.attachRoom(room, ctx);
    const onSpeakers = (speakers: unknown) => {
      if (this.attached !== room) return;
      const next: Record<string, boolean> = {};
      let self = false;
      for (const p of (speakers as Array<{ identity?: string }>) ?? []) {
        if (!p?.identity) continue;
        if (p.identity === this.config.userId) self = true;
        else next[p.identity] = true;
      }
      this.speaking = next;
      this.selfSpeaking = self;
      this.emit();
    };
    this.speakHandler = onSpeakers;
    room.on("activeSpeakersChanged", onSpeakers);
  }

  private detachRoom(): void {
    const room = this.attached;
    if (!room) return;
    this.attached = null;
    if (this.speakHandler) room.off("activeSpeakersChanged", this.speakHandler);
    this.speakHandler = null;
    this.speaking = {};
    this.selfSpeaking = false;
    void this.local.detachRoom(room); // preserva intenção de mic/cam; encerra screen share
    this.remote.detachRoom(room);
    this.spatial.detachRoom(room);
  }

  private onPresence(): void {
    const online = this.presence.getRoster();
    for (const uid of this.movement.getRemoteStates().keys()) {
      if (!online.has(uid)) {
        this.movement.forgetRemote(uid);
        this.spatial.removeRemotePosition(uid);
      }
    }
    this.emit();
  }

  private mediaPeers(): string[] {
    const ctx = this.rooms.getSnapshot().connected;
    const ids = this.remote.getSnapshot().participants.map((p) => p.identity);
    if (!ctx || !this.attached) return [];
    if (ctx.kind === "PRIVATE_ROOM") return ids;
    const inRange = new Set(this.spatial.getInRange());
    return ids.filter((id) => inRange.has(id));
  }

  private emitIfRangeChanged(): void {
    const key = this.spatial.getInRange().slice().sort().join(",");
    if (key === this.lastInRangeKey) return;
    this.emit();
  }

  private build(): RtcV2Snapshot {
    const r = this.rooms.getSnapshot();
    return {
      roomStatus: r.status,
      roomName: r.roomName,
      error: r.error,
      context: this.context.getSnapshot().context,
      local: this.local.getSnapshot(),
      remote: this.remote.getSnapshot(),
      mediaPeers: this.mediaPeers(),
      speaking: this.speaking,
      selfSpeaking: this.selfSpeaking,
      avatars: new Map(this.movement.getRemoteStates()),
      online: new Map(this.presence.getRoster()),
      disposed: this.disposed,
    };
  }

  private emit(): void {
    if (this.disposed) return;
    this.lastInRangeKey = this.spatial.getInRange().slice().sort().join(",");
    this.snap = this.build();
    for (const l of this.listeners) l();
  }
}

// ─── Room de produção (única `new Room()` do path V2) ─────────────────────

export async function createV2RoomFactory(): Promise<() => V2Room> {
  const lk = await import("livekit-client");
  const { isV2LocalTrack } = await import("./rtc-v2-devices");
  return () => {
    const room = new lk.Room({
      adaptiveStream: true,
      dynacast: true,
      publishDefaults: {
        dtx: true,
        red: true,
        simulcast: false,
        videoEncoding: { maxBitrate: 450_000, maxFramerate: 15 },
      },
    });
    const publishOpts = (source: string) => {
      switch (source) {
        case "microphone":
          return {
            source: lk.Track.Source.Microphone,
            dtx: true,
            red: true,
            audioPreset: lk.AudioPresets.speech,
          };
        case "camera":
          return { source: lk.Track.Source.Camera, simulcast: false };
        case "screen_share":
          return { source: lk.Track.Source.ScreenShare };
        default:
          return { source: lk.Track.Source.ScreenShareAudio };
      }
    };
    const v2: V2Room = {
      connect: (url, token, opts) =>
        room.connect(url, token, { autoSubscribe: opts.autoSubscribe }),
      disconnect: () => room.disconnect(false),
      // Nomes de evento idênticos aos valores de RoomEvent do livekit-client.
      on: (e, fn) => void room.on(e as never, fn as never),
      off: (e, fn) => void room.off(e as never, fn as never),
      get remoteParticipants() {
        return room.remoteParticipants as unknown as V2Room["remoteParticipants"];
      },
      async publishTrack(track) {
        if (!isV2LocalTrack(track)) throw new Error("track inválida");
        await room.localParticipant.publishTrack(
          track.lk as never,
          publishOpts(track.source) as never,
        );
      },
      async unpublishTrack(track) {
        if (!isV2LocalTrack(track)) return;
        await room.localParticipant.unpublishTrack(track.lk as never, false);
      },
      async setAudioOutput(deviceId) {
        await room.switchActiveDevice("audiooutput", deviceId);
      },
    };
    return v2;
  };
}
