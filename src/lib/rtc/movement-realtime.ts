/**
 * RTC v2 — Etapa 10: movimento de avatares via Supabase Broadcast.
 *
 * Canal privado `workspace:{workspaceId}:movement`. NUNCA usa Presence.
 * Aceita atualizações locais a 60 FPS, mas só transmite:
 *  - MOTION_START  (parado → movendo, imediato)
 *  - MOTION_CHANGE (mudança significativa de vetor)
 *  - MOTION_STOP   (movendo → parado, posição final exata)
 *  - POSITION_SYNC (a cada ~1000 ms somente enquanto move)
 *  - SNAPSHOT_REQUEST  (uma vez por assinatura SUBSCRIBED — bootstrap/reconexão)
 *  - POSITION_SNAPSHOT (resposta com o PRÓPRIO estado; nunca gera outro request)
 *
 * Ordenação: seq monotônico por sessão. Para (userId, generation) remotos,
 * eventos com seq <= lastAcceptedSeq são ignorados. Generation maior substitui
 * a sessão anterior; eventos de generation menor são ignorados. Timestamp é só
 * diagnóstico. Este módulo NÃO decide proximidade, zona, Room ou subscriptions.
 * Ainda não integrado ao Office.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { emitTelemetry, type RtcTelemetrySink } from "./rtc-telemetry-types";

export type MovementEventType =
  | "MOTION_START"
  | "MOTION_CHANGE"
  | "MOTION_STOP"
  | "POSITION_SYNC"
  | "SNAPSHOT_REQUEST"
  | "POSITION_SNAPSHOT";

export interface MovementEvent {
  type: MovementEventType;
  userId: string;
  sessionId: string;
  generation: number;
  seq: number;
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  moving?: boolean;
  /** Somente diagnóstico — nunca usado para ordenar. */
  ts?: number;
}

export interface RemoteAvatarState {
  userId: string;
  sessionId: string;
  generation: number;
  seq: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  moving: boolean;
}

export interface MovementSelf {
  userId: string;
  sessionId: string;
  generation: number;
}

export interface MovementTransportHandlers {
  onEvent(event: MovementEvent): void;
  /** Chamado a cada SUBSCRIBED (inicial ou após reconexão). */
  onSubscribed(isReconnect: boolean): void;
  onError?(message: string): void;
}

export interface MovementTransportHandle {
  send(event: MovementEvent): void;
  close(): Promise<void> | void;
}

export interface MovementTransport {
  open(handlers: MovementTransportHandlers): MovementTransportHandle;
}

export interface MovementRealtimeOptions {
  self: MovementSelf;
  transport: MovementTransport;
  syncIntervalMs?: number;
  /** Ângulo mínimo (graus) para MOTION_CHANGE. */
  changeAngleDeg?: number;
  /** Variação relativa mínima de velocidade para MOTION_CHANGE. */
  speedChangeRatio?: number;
  /** Velocidade abaixo disso = parado. */
  stopEpsilon?: number;
  /** Somente falhas de canal/broadcast. Movimento normal NUNCA é registrado. */
  telemetry?: RtcTelemetrySink;
}

export const POSITION_SYNC_INTERVAL_MS = 1000;

export function movementTopic(workspaceId: string): string {
  return `workspace:${workspaceId}:movement`;
}

const MOVEMENT_TYPES = new Set<MovementEventType>([
  "MOTION_START",
  "MOTION_CHANGE",
  "MOTION_STOP",
  "POSITION_SYNC",
  "SNAPSHOT_REQUEST",
  "POSITION_SNAPSHOT",
]);

export function isMovementEvent(v: unknown): v is MovementEvent {
  const e = v as MovementEvent;
  return (
    !!e &&
    typeof e === "object" &&
    MOVEMENT_TYPES.has(e.type) &&
    typeof e.userId === "string" &&
    typeof e.sessionId === "string" &&
    typeof e.generation === "number" &&
    typeof e.seq === "number"
  );
}

export class MovementRealtime {
  private readonly self: MovementSelf;
  private readonly transport: MovementTransport;
  private readonly syncIntervalMs: number;
  private readonly cosThreshold: number;
  private readonly speedRatio: number;
  private readonly stopEps: number;
  private readonly telemetry?: RtcTelemetrySink;

  private handle: MovementTransportHandle | null = null;
  private epoch = 0;
  private seq = 0;
  private disposed = false;

  private local: { x: number; y: number; vx: number; vy: number } | null = null;
  private moving = false;
  private lastSentVector = { vx: 0, vy: 0 };
  private syncTimer: ReturnType<typeof setInterval> | null = null;

  private remotes = new Map<string, RemoteAvatarState>();
  private listeners = new Set<(states: ReadonlyMap<string, RemoteAvatarState>) => void>();
  private lastError: string | null = null;

  constructor(opts: MovementRealtimeOptions) {
    this.self = opts.self;
    this.transport = opts.transport;
    this.syncIntervalMs = opts.syncIntervalMs ?? POSITION_SYNC_INTERVAL_MS;
    this.cosThreshold = Math.cos(((opts.changeAngleDeg ?? 20) * Math.PI) / 180);
    this.speedRatio = opts.speedChangeRatio ?? 0.25;
    this.stopEps = opts.stopEpsilon ?? 1e-6;
    this.telemetry = opts.telemetry;
  }

  start(): void {
    if (this.disposed || this.handle) return;
    const myEpoch = ++this.epoch;
    let subscribedBefore = false;
    this.handle = this.transport.open({
      onEvent: (e) => {
        if (myEpoch !== this.epoch || this.disposed) return; // canal antigo
        this.receive(e);
      },
      onSubscribed: () => {
        if (myEpoch !== this.epoch || this.disposed) return;
        const isReconnect = subscribedBefore;
        subscribedBefore = true;
        void isReconnect;
        // Uma única solicitação por assinatura (bootstrap ou reconexão).
        this.emit({ type: "SNAPSHOT_REQUEST" });
      },
      onError: (msg) => {
        if (myEpoch !== this.epoch) return;
        this.lastError = msg;
        emitTelemetry(this.telemetry, "BROADCAST_ERROR", {
          error: { code: "BROADCAST_ERROR", message: msg },
          metadata: { channel: "movement" },
        });
      },
    });
  }

  /** Fecha o canal atual e abre um novo; eventos do canal antigo são descartados. */
  async restart(): Promise<void> {
    const old = this.handle;
    this.handle = null;
    this.epoch++;
    if (old) await old.close();
    this.start();
  }

  get error(): string | null {
    return this.lastError;
  }

  /** Pode ser chamado a cada frame; só transmite em transições relevantes. */
  updateLocal(x: number, y: number, vx: number, vy: number): void {
    if (this.disposed) return;
    this.local = { x, y, vx, vy };
    const nowMoving = Math.hypot(vx, vy) > this.stopEps;
    if (nowMoving && !this.moving) {
      this.moving = true;
      this.lastSentVector = { vx, vy };
      this.emit(this.motion("MOTION_START"));
      this.startSync();
    } else if (!nowMoving && this.moving) {
      this.moving = false;
      this.stopSync();
      this.lastSentVector = { vx: 0, vy: 0 };
      this.emit(this.motion("MOTION_STOP"));
    } else if (nowMoving && this.vectorChanged(vx, vy)) {
      this.lastSentVector = { vx, vy };
      this.emit(this.motion("MOTION_CHANGE"));
    }
  }

  getRemoteStates(): ReadonlyMap<string, RemoteAvatarState> {
    return this.remotes;
  }

  subscribe(fn: (states: ReadonlyMap<string, RemoteAvatarState>) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.stopSync();
    this.epoch++;
    const h = this.handle;
    this.handle = null;
    this.listeners.clear();
    if (h) await h.close();
  }

  // ─── internos ──────────────────────────────────────────────

  private vectorChanged(vx: number, vy: number): boolean {
    const a = this.lastSentVector;
    const la = Math.hypot(a.vx, a.vy);
    const lb = Math.hypot(vx, vy);
    if (la === 0 || lb === 0) return la !== lb;
    const cos = (a.vx * vx + a.vy * vy) / (la * lb);
    if (cos < this.cosThreshold) return true;
    return Math.abs(lb - la) / la > this.speedRatio;
  }

  private motion(
    type: MovementEventType,
  ): Omit<MovementEvent, "userId" | "sessionId" | "generation" | "seq"> {
    const l = this.local!;
    const stopped = type === "MOTION_STOP";
    return {
      type,
      x: l.x,
      y: l.y,
      vx: stopped ? 0 : l.vx,
      vy: stopped ? 0 : l.vy,
      moving: !stopped,
    };
  }

  private startSync(): void {
    this.stopSync();
    this.syncTimer = setInterval(() => {
      if (!this.moving || !this.local || this.disposed) return;
      this.emit(this.motion("POSITION_SYNC"));
    }, this.syncIntervalMs);
  }

  private stopSync(): void {
    if (this.syncTimer) clearInterval(this.syncTimer);
    this.syncTimer = null;
  }

  private emit(partial: Omit<MovementEvent, "userId" | "sessionId" | "generation" | "seq">): void {
    if (!this.handle || this.disposed) return;
    this.seq += 1;
    this.handle.send({
      ...partial,
      userId: this.self.userId,
      sessionId: this.self.sessionId,
      generation: this.self.generation,
      seq: this.seq,
      ts: Date.now(),
    });
  }

  private receive(e: MovementEvent): void {
    if (!isMovementEvent(e) || e.userId === this.self.userId) return;

    if (e.type === "SNAPSHOT_REQUEST") {
      // Responde apenas com o próprio estado; nunca gera outro request.
      if (this.local) {
        this.emit({
          type: "POSITION_SNAPSHOT",
          x: this.local.x,
          y: this.local.y,
          vx: this.moving ? this.local.vx : 0,
          vy: this.moving ? this.local.vy : 0,
          moving: this.moving,
        });
      }
      return;
    }

    if (typeof e.x !== "number" || typeof e.y !== "number") return;
    const prev = this.remotes.get(e.userId);
    if (prev) {
      if (e.generation < prev.generation) return;
      if (e.generation === prev.generation) {
        if (e.sessionId !== prev.sessionId) return;
        if (e.seq <= prev.seq) return;
      }
      // generation maior → nova sessão; controle de seq anterior descartado.
    }
    const moving = e.type === "MOTION_STOP" ? false : (e.moving ?? true);
    this.remotes.set(e.userId, {
      userId: e.userId,
      sessionId: e.sessionId,
      generation: e.generation,
      seq: e.seq,
      x: e.x,
      y: e.y,
      vx: moving ? (e.vx ?? 0) : 0,
      vy: moving ? (e.vy ?? 0) : 0,
      moving,
    });
    for (const fn of this.listeners) fn(this.remotes);
  }
}

/**
 * Interface abstrata para futura persistência da última posição conhecida
 * (spawn/recuperação). Não implementada nesta etapa; nunca escrever por frame
 * nem por segundo. Broadcast continua sendo a fonte do movimento ao vivo.
 */
export interface LastKnownPositionStore {
  load(workspaceId: string, userId: string): Promise<{ x: number; y: number } | null>;
  save(workspaceId: string, userId: string, pos: { x: number; y: number }): Promise<void>;
}

export const MOVEMENT_BROADCAST_EVENT = "movement";

/** Adaptador Supabase: canal privado exclusivo de movimento, sem Presence. */
export function createSupabaseMovementTransport(
  supabase: SupabaseClient,
  workspaceId: string,
): MovementTransport {
  return {
    open(handlers) {
      let subscribedBefore = false;
      const channel = supabase.channel(movementTopic(workspaceId), {
        config: { private: true, broadcast: { self: false, ack: false } },
      });
      channel.on("broadcast", { event: MOVEMENT_BROADCAST_EVENT }, ({ payload }) => {
        if (isMovementEvent(payload)) handlers.onEvent(payload);
      });
      channel.subscribe((status, err) => {
        if (status === "SUBSCRIBED") {
          handlers.onSubscribed(subscribedBefore);
          subscribedBefore = true;
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          handlers.onError?.(`${status}${err ? `: ${err.message}` : ""}`);
        }
      });
      return {
        send(event) {
          void channel.send({ type: "broadcast", event: MOVEMENT_BROADCAST_EVENT, payload: event });
        },
        async close() {
          await supabase.removeChannel(channel);
        },
      };
    },
  };
}
