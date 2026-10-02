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
export const SOLO_GRACE_MS = 15_000;

export function parseRtcOnDemand(raw?: string | null): RtcOnDemandMode {
  const v = (raw ?? "").toString().trim().toLowerCase();
  // "all" fica reservado para a Fase 2 (lobby); por ora comporta-se como "private".
  if (v === "private" || v === "all") return v;
  return DEFAULT_RTC_ON_DEMAND;
}

export function getRtcOnDemand(): RtcOnDemandMode {
  const raw = import.meta?.env?.VITE_RTC_ON_DEMAND;
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
  private disposed = false;
  private listeners = new Set<(d: RtcDemand) => void>();
  private readonly timers: TimerApi;
  private readonly graceMs: number;

  constructor(private readonly deps: DemandControllerDeps) {
    this.timers = deps.timers ?? defaultTimers;
    this.graceMs = deps.graceMs ?? SOLO_GRACE_MS;
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
    this.listeners.clear();
  }

  private evaluate(): void {
    const i = this.input;
    if (!i) return;
    const ctx = i.context;
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
    const cur = this.demand;
    if (cur.kind === "PRIVATE" && cur.zoneId === zoneId) {
      // Conectado e ficou sozinho: grace antes de soltar.
      if (this.grace == null) this.armGrace(zoneId, i.occupants);
      return;
    }
    this.cancelGrace(zoneId);
    this.set(NONE, "alone", i);
  }

  private armGrace(zoneId: string, occupantCount: number): void {
    emitTelemetry(this.deps.telemetry, "RTC_SOLO_GRACE_ARMED", {
      zoneId,
      metadata: { occupantCount, graceMs: this.graceMs },
    });
    this.grace = this.timers.setTimeout(() => {
      this.grace = null;
      if (this.disposed || !this.input) return;
      const i = this.input;
      const stillAlone =
        i.context.kind === "PRIVATE_ROOM" &&
        i.context.zoneId === zoneId &&
        i.occupants < 2 &&
        !i.recordingActive;
      if (!stillAlone) return this.evaluate();
      if (i.roomStatus === "RECONNECTING") {
        // Reconexão nativa do LiveKit tem prioridade: tenta de novo depois.
        this.armGrace(zoneId, i.occupants);
        return;
      }
      emitTelemetry(this.deps.telemetry, "RTC_SOLO_GRACE_EXPIRED", {
        zoneId,
        metadata: { occupantCount: i.occupants },
      });
      this.set(NONE, "solo_grace_expired", i);
    }, this.graceMs);
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
    for (const l of this.listeners) l(next);
  }
}
