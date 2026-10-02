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
import { findZoneById } from "@/lib/office-map";
import { RtcDemandTrace, shortId } from "./rtc-demand-trace";
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
import { AudioDiagnostics, type DiagTimers } from "./rtc-audio-diagnostics";
import { RtcTelemetry, type TelemetryAdapter } from "./rtc-telemetry";
import { isMapVersionStaleError } from "./rtc-telemetry-types";
import {
  SpatialSubscriptions,
  computeNearby,
  type Position,
  type SpatialRoomLike,
} from "./spatial-subscriptions";
import { PrivacyGuard, type PrivacyGuardTimers } from "./privacy-guard";
import {
  RtcDemandController,
  countOccupants,
  demandToContext,
  type RtcDemand,
  type RtcOnDemandMode,
} from "./rtc-demand-controller";

/** Room composta usada pelo V2 (uma única Room LiveKit por trás). */
export interface V2Room extends RoomLike, PublishTargetLike {
  readonly remoteParticipants: RemoteRoomLike["remoteParticipants"] &
    SpatialRoomLike["remoteParticipants"];
  on(event: string, fn: (...args: unknown[]) => void): void;
  off(event: string, fn: (...args: unknown[]) => void): void;
  setAudioOutput?(deviceId: string): Promise<void>;
  /** Room livekit-client crua — SOMENTE para diagnóstico (Etapa 14A). */
  readonly raw?: unknown;
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
  /** Timers do diagnóstico de áudio (testes). */
  diagTimers?: DiagTimers;
  privacyTimers?: PrivacyGuardTimers;
  /** RTC On Demand (VITE_RTC_ON_DEMAND). Padrão "off" = comportamento atual. */
  onDemandMode?: RtcOnDemandMode;
  demandTimers?: TimerApi;
  soloGraceMs?: number;
  lobbyGraceMs?: number;
}

export interface RtcV2Snapshot {
  roomStatus: RoomManagerSnapshot["status"];
  roomName: string | null;
  error: string | null;
  /** Status + contexto da Room realmente conectada (referência estável). */
  room: { status: RoomManagerSnapshot["status"]; connected: MediaContext | null };
  context: MediaContext;
  local: LocalMediaSnapshot;
  remote: RemoteMediaSnapshot;
  /** userIds com mídia autorizada: PRIVATE_ROOM = todos da Room; LOBBY = em alcance. */
  mediaPeers: string[];
  speaking: Record<string, boolean>;
  selfSpeaking: boolean;
  avatars: ReadonlyMap<string, RemoteAvatarState>;
  online: ReadonlyMap<string, PresencePayload>;
  /** RTC On Demand: destino desejado de conexão. */
  demand: RtcDemand;
  /** Sozinho numa sala privada sem LiveKit (estado neutro, não é erro). */
  awaitingPeer: boolean;
  /** Fase 2: no corredor sem ninguém próximo e sem LiveKit (estado neutro). */
  lobbyIdle: boolean;
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
  /** Etapa 14A: observador de áudio; nunca controla o RTC. */
  readonly audioDiag: AudioDiagnostics;

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
  readonly privacy: PrivacyGuard;
  readonly demand: RtcDemandController;
  private recordingActive = false;
  private readonly demandTrace = new RtcDemandTrace();
  private selfPos: { x: number; y: number } | null = null;
  private idleTimer: unknown = null;
  private lastInRangeKey = "";
  /** Fase 2: peers próximos no lobby (estado da histerese compartilhada). */
  private lobbyNear = new Set<string>();
  private lastNearKey = "";
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
    this.audioDiag = new AudioDiagnostics({
      sink,
      getMicIntent: () => this.local.getSnapshot().microphone.intent,
      getMicTrack: () =>
        this.local.getTrack("microphone") as unknown as {
          mediaStreamTrack?: MediaStreamTrack;
          lk?: unknown;
        } | null,
      getRoomName: () => this.rooms.getSnapshot().roomName,
      timers: deps.diagTimers,
    });
    this.privacy = new PrivacyGuard(
      {
        // Somente câmera: o guard não recebe acesso ao microfone nem ao screen share.
        isCamOn: () => this.local.getSnapshot().camera.intent,
        setCam: (on) => this.local.setCameraEnabled(on),
      },
      { telemetry: sink, timers: deps.privacyTimers },
    );
    this.demand = new RtcDemandController({
      mode: deps.onDemandMode ?? "off",
      timers: deps.demandTimers ?? this.timers,
      graceMs: deps.soloGraceMs,
      lobbyGraceMs: deps.lobbyGraceMs,
      telemetry: sink,
    });
    this.snap = this.build();
  }

  // ─── ciclo de vida ─────────────────────────────────────────

  start(): void {
    if (this.started || this.disposed) return;
    this.started = true;
    this.unsubs.push(
      this.demand.subscribe((d) => this.onDemand(d)),
      this.context.subscribe((s) => {
        // off: exatamente o caminho anterior (contexto → RoomManager).
        if (this.demand.mode === "off") this.rooms.setDesiredContext(s.context);
        else this.reevaluateDemand();
      }),
      this.rooms.subscribe((s) => {
        this.onRooms(s);
        this.reevaluateDemand();
      }),
      this.local.subscribe(() => {
        this.audioDiag.onLocalMediaChange();
        this.privacy.onLocalMediaChange();
        this.emit();
      }),
      this.remote.subscribe(() => {
        this.reevaluateDemand();
        this.emit();
      }),
      this.movement.subscribe((states) => {
        for (const [uid, st] of states) this.spatial.setRemotePosition(uid, { x: st.x, y: st.y });
        this.reevaluateLobbyIfChanged();
        this.emit();
      }),
      this.presence.subscribe(() => {
        this.onPresence();
        this.reevaluateDemand();
      }),
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
    this.audioDiag.dispose();
    this.privacy.dispose();
    this.demand.dispose();
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
    this.reevaluateLobbyIfChanged();
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
    this.movement.announcePosition({ jump: true });
  }

  toggleMic(): Promise<void> {
    this.privacy.noteManualToggle();
    return this.local.setMicrophoneEnabled(!this.local.getSnapshot().microphone.intent);
  }
  toggleCam(): Promise<void> {
    this.privacy.noteManualToggle();
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

  /** Gravação Egress ativa mantém a Room mesmo com 1 humano. */
  setRecordingActive(active: boolean): void {
    if (this.disposed || this.recordingActive === active) return;
    this.recordingActive = active;
    this.reevaluateDemand();
  }

  // ─── RTC On Demand ─────────────────────────────────────────

  private reevaluateDemand(): void {
    if (this.disposed) return;
    if (this.demand.mode === "off") return;
    const ctx = this.context.getSnapshot().context;
    {
      this.presence.setMediaLocation(
        ctx.kind === "PRIVATE_ROOM" ? `PRIVATE:${ctx.zoneId}` : ctx.kind === "LOBBY" ? "LOBBY" : null,
      );
    }
    let occupants = 1;
    if (ctx.kind === "PRIVATE_ROOM") {
      const r = this.rooms.getSnapshot();
      const live =
        r.connected?.kind === "PRIVATE_ROOM" &&
        r.connected.zoneId === ctx.zoneId &&
        (r.status === "CONNECTED" || r.status === "RECONNECTING")
          ? this.remote.getSnapshot().participants.length
          : 0;
      // zoneId vem só do MEU contexto; outros servem apenas para contar.
      occupants = countOccupants(this.config.userId, ctx.zoneId, this.presence.getRoster().values(), live);
    }
    const nearby = this.computeLobbyNearby();
    const cs = this.context.getSnapshot();
    this.demand.update({
      context: ctx,
      occupants,
      recordingActive: this.recordingActive,
      roomStatus: this.rooms.getSnapshot().status,
      nearbyLobbyPeers: nearby,
      contextStable: this.selfPos != null && cs.state !== "CANDIDATE_PRIVATE_ROOM",
    });
    this.traceDemand(occupants);
  }

  /**
   * Fase 2: quantos peers online do lobby estão no alcance, usando a MESMA
   * histerese do SpatialSubscriptions. Posições vêm só do Movement (Broadcast);
   * Presence só filtra quem está online e fora de sala privada.
   */
  private computeLobbyNearby(): number {
    if (this.demand.mode !== "all" || this.context.getSnapshot().context.kind !== "LOBBY") {
      this.lobbyNear.clear();
      this.lastNearKey = "";
      return 0;
    }
    const roster = this.presence.getRoster();
    const remotes: Array<[string, Position]> = [];
    for (const [uid, st] of this.movement.getRemoteStates()) {
      if (uid === this.config.userId) continue;
      if (roster.size > 0) {
        const p = roster.get(uid);
        if (!p) continue; // não está online
        if (p.mediaLocation?.startsWith("PRIVATE:")) continue; // está numa sala
      }
      remotes.push([uid, { x: st.x, y: st.y }]);
    }
    this.lobbyNear = computeNearby(this.selfPos, remotes, this.lobbyNear);
    this.lastNearKey = [...this.lobbyNear].sort().join(",");
    return this.lobbyNear.size;
  }

  /** Reavalia só quando o conjunto de próximos muda (movimento a 60 FPS não gera churn). */
  private reevaluateLobbyIfChanged(): void {
    if (this.disposed || !this.started || this.demand.mode !== "all") return;
    const before = this.lastNearKey;
    const prev = new Set(this.lobbyNear);
    this.computeLobbyNearby();
    if (this.lastNearKey === before) return;
    this.lobbyNear = prev; // reevaluateDemand recalcula a partir do estado anterior
    this.reevaluateDemand();
  }

  private lastTraceOccupants = 1;
  private traceDemand(occupants?: number): void {
    if (!this.demandTrace.on) return;
    try {
      if (occupants != null) this.lastTraceOccupants = occupants;
      const ctx = this.context.getSnapshot();
      const r = this.rooms.getSnapshot();
      const fmt = (c: MediaContext | null) =>
        !c ? "NONE" : c.kind === "PRIVATE_ROOM" ? `PRIVATE:${c.zoneId}` : c.kind;
      const zoneId = ctx.context.kind === "PRIVATE_ROOM" ? ctx.context.zoneId : null;
      const myLoc = zoneId ? `PRIVATE:${zoneId}` : ctx.context.kind === "LOBBY" ? "LOBBY" : null;
      const remote: Record<string, string | null> = {};
      let presenceCount = 1;
      for (const o of this.presence.getRoster().values()) {
        if (o.userId === this.config.userId) continue;
        remote[shortId(o.userId)] = o.mediaLocation ?? null;
        if (myLoc && zoneId && o.mediaLocation === myLoc) presenceCount++;
      }
      const d = this.demand.getDemand();
      this.demandTrace.record({
        client: shortId(this.config.userId),
        myZone: { id: zoneId, name: zoneId ? (findZoneById(zoneId)?.label ?? null) : null },
        myMediaLocation: myLoc,
        remoteMediaLocations: remote,
        presenceOccupantCount: presenceCount,
        livekitRemoteCount: this.remote.getSnapshot().participants.length,
        occupantCount: this.lastTraceOccupants,
        rtcDemand: d.kind === "PRIVATE" ? `PRIVATE:${d.zoneId}` : d.kind,
        activeContext: fmt(r.connected),
        desiredContext: fmt(r.desired),
        soloGraceState: this.demand.isGraceArmed() ? "ARMED" : "IDLE",
        nearbyLobbyPeerCount: this.lobbyNear.size,
        lobbyGraceState: this.demand.isLobbyGraceArmed() ? "ARMED" : "IDLE",
        recordingActive: this.recordingActive,
      });
    } catch {
      /* trace nunca altera comportamento */
    }
  }

  private onDemand(d: RtcDemand): void {
    if (this.demand.mode === "off") return;
    this.rooms.setDesiredContext(demandToContext(d));
    const ctx = this.context.getSnapshot().context;
    if (d.kind === "NONE" && ctx.kind !== "OFFLINE") void this.local.suspendCapture();
    else if (this.local.isCaptureSuspended()) void this.local.resumeCapture();
    this.emit();
    this.traceDemand();
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
    this.audioDiag.attachRoom(room.raw, ctx);
  }

  private detachRoom(): void {
    const room = this.attached;
    if (!room) return;
    this.attached = null;
    this.audioDiag.detachRoom();
    if (this.speakHandler) room.off("activeSpeakersChanged", this.speakHandler);
    this.speakHandler = null;
    this.speaking = {};
    this.selfSpeaking = false;
    void this.local.detachRoom(room); // preserva intenção de mic/cam; encerra screen share
    this.remote.detachRoom(room);
    this.spatial.detachRoom(room);
  }

  /**
   * Só esquece posição de quem SAIU do Presence (estava online e não está mais).
   * Quem ainda não apareceu no Presence (join em trânsito, sync inicial vazio,
   * rejoin) mantém a posição recebida pelo Movement — usuário parado não
   * reenviaria posição e ficaria sem proximidade para sempre.
   */
  private prevOnline = new Set<string>();
  private onPresence(): void {
    const online = this.presence.getRoster();
    // Roster vazio = canal em (re)sync; não é evidência de saída.
    if (online.size === 0) {
      this.emit();
      return;
    }
    for (const uid of this.prevOnline) {
      if (!online.has(uid) && this.movement.getRemoteStates().has(uid)) {
        this.movement.forgetRemote(uid);
        this.spatial.removeRemotePosition(uid);
      }
    }
    this.prevOnline = new Set(online.keys());
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
      room:
        this.snap && this.snap.room.status === r.status && this.snap.room.connected === r.connected
          ? this.snap.room
          : { status: r.status, connected: r.connected },
      context: this.context.getSnapshot().context,
      local: this.local.getSnapshot(),
      remote: this.remote.getSnapshot(),
      mediaPeers: this.mediaPeers(),
      speaking: this.speaking,
      selfSpeaking: this.selfSpeaking,
      avatars: new Map(this.movement.getRemoteStates()),
      online: new Map(this.presence.getRoster()),
      demand: this.demand?.getDemand() ?? { kind: "NONE" },
      awaitingPeer:
        !!this.demand &&
        this.demand.mode !== "off" &&
        this.demand.getDemand().kind === "NONE" &&
        this.context.getSnapshot().context.kind === "PRIVATE_ROOM",
      lobbyIdle:
        !!this.demand &&
        this.demand.mode === "all" &&
        this.demand.getDemand().kind === "NONE" &&
        this.context.getSnapshot().context.kind === "LOBBY",
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
      raw: room,
      async setAudioOutput(deviceId) {
        await room.switchActiveDevice("audiooutput", deviceId);
      },
    };
    return v2;
  };
}
