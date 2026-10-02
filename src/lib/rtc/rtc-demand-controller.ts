/**
 * RTC On Demand — Fase 1 (salas privadas).
 *
 * Módulo puro: decide SOMENTE o destino de conexão desejado
 * (NONE | LOBBY | PRIVATE(zoneId)). Nunca conecta/desconecta — o
 * LiveKitRoomManager continua o único dono de connect()/disconnect().
 *
 * Regra fundamental: o zoneId vem EXCLUSIVAMENTE do meu MediaContext
 * (minha posição). A ocupação (outros usuários) só decide NONE vs PRIVATE(myZone).
 */
import type { MediaContext, TimerApi } from "./media-context";
import { emitTelemetry, type RtcTelemetrySink } from "./rtc-telemetry-types";
import type { RoomManagerStatus } from "./livekit-room-manager";

export type RtcOnDemandMode = "off" | "private" | "all";
export const DEFAULT_RTC_ON_DEMAND: RtcOnDemandMode = "off";
/**
 * Sem grace de mídia: sala privada que cai para 1 vai a NONE na hora.
 * (A continuidade de 15s é só administrativa — MeetingTrackerV2.)
 */
export const SOLO_GRACE_MS = 0;
/** Lobby: só debounce técnico contra jitter de posição (não perceptível). */
export const LOBBY_IDLE_GRACE_MS = 750;
export const MAX_LOBBY_DEBOUNCE_MS = 1_000;

export function parseRtcOnDemand(raw?: string | null): RtcOnDemandMode {
  const v = (raw ?? "").toString().trim().toLowerCase();
  if (v === "private") return "private";
  if (v === "all") return "all";
  return DEFAULT_RTC_ON_DEMAND;
}

export function getRtcOnDemand(): RtcOnDemandMode {
  // Acesso direto (sem "?.") — o Vite só injeta VITE_* nesse padrão; com
  // optional chaining a flag ficava inerte e caía sempre no default.
  const raw = import.meta.env.VITE_RTC_ON_DEMAND;
  return parseRtcOnDemand(typeof raw === "string" ? raw : undefined);
}

export type RtcDemand = { kind: "NONE" } | { kind: "LOBBY" } | { kind: "PRIVATE"; zoneId: string };

export interface DemandInput {
  /** Meu contexto (derivado só da minha posição). */
  context: MediaContext;
  /** Ocupantes humanos válidos na MINHA zona, incluindo eu. */
  occupants: number;
  recordingActive: boolean;
  roomStatus: RoomManagerStatus | null;
  /** Fase 2 ("all"): peers online no lobby dentro do critério espacial. */
  nearbyLobbyPeers?: number;
  /** Fase 2: false enquanto a zona ainda está sendo classificada. */
  contextStable?: boolean;
}

export function demandToContext(d: RtcDemand): MediaContext {
  if (d.kind === "PRIVATE") return { kind: "PRIVATE_ROOM", zoneId: d.zoneId };
  if (d.kind === "LOBBY") return { kind: "LOBBY" };
  return { kind: "OFFLINE" };
}

export function sameDemand(a: RtcDemand, b: RtcDemand): boolean {
  if (a.kind !== b.kind) return false;
  return a.kind !== "PRIVATE" || a.zoneId === (b as { zoneId: string }).zoneId;
}

/** Ocupação = eu + outros cujo mediaLocation === PRIVATE:<minha zona>. */
export function countOccupants(
  myUserId: string,
  zoneId: string,
  others: Iterable<{ userId: string; mediaLocation?: string | null }>,
  liveRemoteCount = 0,
): number {
  const tag = `PRIVATE:${zoneId}`;
  const ids = new Set<string>();
  for (const o of others) if (o.userId !== myUserId && o.mediaLocation === tag) ids.add(o.userId);
  return 1 + Math.max(ids.size, liveRemoteCount);
}

export interface DemandControllerDeps {
  mode: RtcOnDemandMode;
  timers?: TimerApi;
  graceMs?: number;
  lobbyGraceMs?: number;
  telemetry?: RtcTelemetrySink;
}

const NONE: RtcDemand = { kind: "NONE" };

const defaultTimers: TimerApi = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (h) => globalThis.clearTimeout(h as ReturnType<typeof setTimeout>),
};

export class RtcDemandController {
  private demand: RtcDemand = NONE;
  private input: DemandInput | null = null;
  private grace: unknown = null;
  private lobbyGrace: unknown = null;
  private disposed = false;
  private listeners = new Set<(d: RtcDemand) => void>();
  private readonly timers: TimerApi;
  private readonly lobbyGraceMs: number;

  constructor(private readonly deps: DemandControllerDeps) {
    this.timers = deps.timers ?? defaultTimers;
    // Grace de mídia removido por privacidade: valores legados são ignorados/limitados.
    this.lobbyGraceMs = Math.min(
      Math.max(0, deps.lobbyGraceMs ?? LOBBY_IDLE_GRACE_MS),
      MAX_LOBBY_DEBOUNCE_MS,
    );
  }

  get mode(): RtcOnDemandMode {
    return this.deps.mode;
  }
  getDemand(): RtcDemand {
    return this.demand;
  }
  isGraceArmed(): boolean {
    return this.grace != null;
  }
  isLobbyGraceArmed(): boolean {
    return this.lobbyGrace != null;
  }
  subscribe(fn: (d: RtcDemand) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  update(input: DemandInput): void {
    if (this.disposed) return;
    this.input = input;
    this.evaluate();
  }

  dispose(): void {
    this.disposed = true;
    this.clearGrace();
    this.clearLobbyGrace();
    this.listeners.clear();
  }

  private evaluate(): void {
    const i = this.input;
    if (!i) return;
    const ctx = i.context;
    if (ctx.kind !== "LOBBY") this.cancelLobbyGrace("context");
    if (this.deps.mode === "all" && ctx.kind === "LOBBY") {
      this.cancelGrace(null);
      return this.evaluateLobby(i);
    }
    if (this.deps.mode === "off" || ctx.kind !== "PRIVATE_ROOM") {
      this.cancelGrace(ctx.kind === "PRIVATE_ROOM" ? ctx.zoneId : null);
      const next: RtcDemand =
        ctx.kind === "PRIVATE_ROOM"
          ? { kind: "PRIVATE", zoneId: ctx.zoneId }
          : ctx.kind === "LOBBY"
            ? { kind: "LOBBY" }
            : NONE;
      this.set(next, ctx.kind === "PRIVATE_ROOM" ? "flag_off" : "context", i);
      return;
    }
    const zoneId = ctx.zoneId; // única fonte do zoneId
    const need = i.occupants >= 2 || i.recordingActive;
    if (need) {
      this.cancelGrace(zoneId);
      this.set(
        { kind: "PRIVATE", zoneId },
        i.occupants >= 2 ? "occupants" : "recording",
        i,
      );
      return;
    }
    // Ficou sozinho: solta a Room imediatamente (sem grace de mídia).
    this.cancelGrace(zoneId);
    this.set(NONE, "alone", i);
  }

  /** Fase 2: lobby só conecta com alguém próximo; afastamento usa grace. */
  private evaluateLobby(i: DemandInput): void {
    const nearby = i.nearbyLobbyPeers ?? 0;
    const cur = this.demand;
    if (i.contextStable === false && cur.kind !== "LOBBY") {
      // Classificação inicial da zona: nunca conectar preventivamente.
      this.set(NONE, "classifying", i);
      return;
    }
    if (nearby >= 1) {
      this.cancelLobbyGrace("peer_nearby", nearby);
      this.set({ kind: "LOBBY" }, "peer_nearby", i);
      return;
    }
    if (cur.kind === "LOBBY") {
      if (this.lobbyGrace == null) this.armLobbyGrace();
      return;
    }
    this.set(NONE, "lobby_alone", i);
  }

  private armLobbyGrace(): void {
    emitTelemetry(this.deps.telemetry, "RTC_LOBBY_GRACE_ARMED", {
      metadata: { nearbyPeerCount: 0, graceMs: this.lobbyGraceMs },
    });
    this.lobbyGrace = this.timers.setTimeout(() => {
      this.lobbyGrace = null;
      if (this.disposed || !this.input) return;
      const i = this.input;
      if (i.context.kind !== "LOBBY" || (i.nearbyLobbyPeers ?? 0) >= 1) return this.evaluate();
      if (i.roomStatus === "RECONNECTING") {
        this.armLobbyGrace();
        return;
      }
      emitTelemetry(this.deps.telemetry, "RTC_LOBBY_GRACE_EXPIRED", {
        metadata: { nearbyPeerCount: 0 },
      });
      this.set(NONE, "lobby_grace_expired", i);
    }, this.lobbyGraceMs);
  }

  private cancelLobbyGrace(reason: string, nearby = 0): void {
    if (this.lobbyGrace == null) return;
    this.clearLobbyGrace();
    emitTelemetry(this.deps.telemetry, "RTC_LOBBY_GRACE_CANCELLED", {
      metadata: { nearbyPeerCount: nearby, reason },
    });
  }

  private clearLobbyGrace(): void {
    if (this.lobbyGrace != null) this.timers.clearTimeout(this.lobbyGrace);
    this.lobbyGrace = null;
  }

  private cancelGrace(zoneId: string | null): void {
    if (this.grace == null) return;
    this.clearGrace();
    emitTelemetry(this.deps.telemetry, "RTC_SOLO_GRACE_CANCELLED", {
      zoneId,
      metadata: { occupantCount: this.input?.occupants ?? null },
    });
  }

  private clearGrace(): void {
    if (this.grace != null) this.timers.clearTimeout(this.grace);
    this.grace = null;
  }

  private set(next: RtcDemand, reason: string, i: DemandInput): void {
    if (sameDemand(next, this.demand)) return;
    const from = this.demand;
    this.demand = next;
    emitTelemetry(this.deps.telemetry, "RTC_DEMAND_CHANGED", {
      zoneId: next.kind === "PRIVATE" ? next.zoneId : null,
      metadata: {
        from: from.kind === "PRIVATE" ? `PRIVATE:${from.zoneId}` : from.kind,
        to: next.kind === "PRIVATE" ? `PRIVATE:${next.zoneId}` : next.kind,
        reason,
        occupantCount: i.occupants,
      },
    });
    if (this.deps.mode === "all" && (from.kind === "LOBBY" || next.kind === "LOBBY")) {
      emitTelemetry(this.deps.telemetry, "RTC_LOBBY_DEMAND_CHANGED", {
        metadata: {
          from: from.kind === "PRIVATE" ? `PRIVATE:${from.zoneId}` : from.kind,
          to: next.kind === "PRIVATE" ? `PRIVATE:${next.zoneId}` : next.kind,
          reason,
          nearbyPeerCount: i.nearbyLobbyPeers ?? 0,
        },
      });
    }
    for (const l of this.listeners) l(next);
  }
}
