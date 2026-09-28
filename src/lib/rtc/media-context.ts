// RTC v2 Etapa 5 — MediaContextController.
//
// Decide, de forma isolada e pura, qual contexto de mídia o PRÓPRIO usuário
// deveria ocupar: OFFLINE | LOBBY | PRIVATE_ROOM(zoneId).
//
// Entradas permitidas (e únicas): estado da sessão, posição do próprio avatar,
// estado do mapa e mapVersion. A zona é derivada SOMENTE da posição própria
// via `resolveZone` injetado. Não existe API para posição de terceiros,
// desiredPeers, roster, Presence ou estado de LiveKit.
//
// Não cria Room, não conecta/desconecta, não publica tracks.

import type { OfficeSessionStatus } from "./office-session";
import type { MapSyncState } from "../map-sync";
import { emitTelemetry, type RtcTelemetrySink } from "./rtc-telemetry-types";

export const PRIVATE_ROOM_CONFIRM_MS = 300;

export type MediaContext =
  | { kind: "OFFLINE" }
  | { kind: "LOBBY" }
  | { kind: "PRIVATE_ROOM"; zoneId: string };

export type MediaContextState =
  | "IDLE"
  | "WAITING_FOR_MAP"
  | "LOBBY"
  | "CANDIDATE_PRIVATE_ROOM"
  | "PRIVATE_ROOM"
  | "ERROR";

export type SelfPosition = { x: number; y: number };

export type ResolvedZone = { id: string; isPrivate: boolean } | null;

export type MapInput = { state: MapSyncState; version: number };

export interface MediaContextSnapshot {
  state: MediaContextState;
  /** Contexto confirmado (efetivo). */
  context: MediaContext;
  /** Intenção mais recente (pode ainda estar em candidatura). */
  desired: MediaContext;
  candidate: { zoneId: string; mapVersion: number; token: number } | null;
  error: string | null;
}

export interface TimerApi {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface MediaContextDeps {
  /** Resolve a zona da posição própria com o mapa atual. */
  resolveZone: (pos: SelfPosition, mapVersion: number) => ResolvedZone;
  timers?: TimerApi;
  confirmMs?: number;
  telemetry?: RtcTelemetrySink;
}

const OFFLINE: MediaContext = { kind: "OFFLINE" };
const LOBBY: MediaContext = { kind: "LOBBY" };

const defaultTimers: TimerApi = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (h) => globalThis.clearTimeout(h as ReturnType<typeof setTimeout>),
};

export function sameContext(a: MediaContext, b: MediaContext): boolean {
  if (a.kind !== b.kind) return false;
  return a.kind !== "PRIVATE_ROOM" || a.zoneId === (b as { zoneId: string }).zoneId;
}

function ctxFields(ctx: MediaContext, prev: MediaContext, mapVersion: number | undefined) {
  return {
    context: ctx.kind,
    zoneId: ctx.kind === "PRIVATE_ROOM" ? ctx.zoneId : null,
    mapVersion: mapVersion ?? null,
    metadata: {
      previousContext: prev.kind,
      previousZoneId: prev.kind === "PRIVATE_ROOM" ? prev.zoneId : null,
    },
  };
}

export class MediaContextController {
  private session: OfficeSessionStatus = "IDLE";
  private map: MapInput | null = null;
  private pos: SelfPosition | null = null;
  private snap: MediaContextSnapshot = {
    state: "IDLE",
    context: OFFLINE,
    desired: OFFLINE,
    candidate: null,
    error: null,
  };
  private timer: unknown = null;
  private token = 0;
  private disposed = false;
  private listeners = new Set<(s: MediaContextSnapshot) => void>();
  private readonly timers: TimerApi;
  private readonly confirmMs: number;

  constructor(private readonly deps: MediaContextDeps) {
    this.timers = deps.timers ?? defaultTimers;
    this.confirmMs = deps.confirmMs ?? PRIVATE_ROOM_CONFIRM_MS;
  }

  getSnapshot(): MediaContextSnapshot {
    return this.snap;
  }

  subscribe(fn: (s: MediaContextSnapshot) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  setSession(status: OfficeSessionStatus): void {
    if (this.session === status) return;
    this.session = status;
    this.evaluate();
  }

  setMap(map: MapInput): void {
    if (this.map && this.map.state === map.state && this.map.version === map.version) return;
    this.map = { ...map };
    this.evaluate();
  }

  setSelfPosition(pos: SelfPosition): void {
    this.pos = { x: pos.x, y: pos.y };
    this.evaluate();
  }

  /** Cancela timers e congela o controlador. Idempotente. */
  dispose(): void {
    this.disposed = true;
    this.cancelCandidate();
    this.listeners.clear();
  }

  /** Quantidade de timers pendentes (0 ou 1) — para testes. */
  pendingTimers(): number {
    return this.timer == null ? 0 : 1;
  }

  // ---------------------------------------------------------------------

  private evaluate(): void {
    if (this.disposed) return;

    if (this.session !== "ACTIVE") {
      this.cancelCandidate();
      return this.commit({ state: "IDLE", context: OFFLINE, desired: OFFLINE, error: null });
    }
    if (!this.map || this.map.state !== "READY") {
      // Bloqueia novas confirmações; mantém o contexto já confirmado.
      this.cancelCandidate();
      return this.commit({ state: "WAITING_FOR_MAP", error: null });
    }
    if (!this.pos) {
      this.cancelCandidate();
      return this.commit({ state: "LOBBY", context: LOBBY, desired: LOBBY, error: null });
    }

    let zone: ResolvedZone;
    try {
      zone = this.deps.resolveZone(this.pos, this.map.version);
    } catch (e) {
      this.cancelCandidate();
      return this.commit({ state: "ERROR", error: e instanceof Error ? e.message : String(e) });
    }

    if (!zone || !zone.isPrivate) {
      this.cancelCandidate();
      return this.commit({ state: "LOBBY", context: LOBBY, desired: LOBBY, error: null });
    }

    const target: MediaContext = { kind: "PRIVATE_ROOM", zoneId: zone.id };
    if (sameContext(this.snap.context, target) && this.snap.state === "PRIVATE_ROOM") {
      this.cancelCandidate();
      return this.commit({ desired: target });
    }
    const c = this.snap.candidate;
    if (c && c.zoneId === zone.id && c.mapVersion === this.map.version) return; // já candidato

    this.startCandidate(zone.id, this.map.version);
  }

  private startCandidate(zoneId: string, mapVersion: number): void {
    this.cancelCandidate();
    const token = ++this.token;
    this.timer = this.timers.setTimeout(() => this.confirm(token), this.confirmMs);
    this.commit({
      state: "CANDIDATE_PRIVATE_ROOM",
      desired: { kind: "PRIVATE_ROOM", zoneId },
      candidate: { zoneId, mapVersion, token },
      error: null,
    });
  }

  private confirm(token: number): void {
    this.timer = null;
    if (this.disposed) return;
    const c = this.snap.candidate;
    // Candidatura antiga ou substituída: nunca confirma.
    if (!c || c.token !== token || token !== this.token) return;
    if (this.session !== "ACTIVE" || !this.map || this.map.state !== "READY" || !this.pos) return;
    if (this.map.version !== c.mapVersion) return this.evaluate();
    // Revalida com a posição e mapa atuais antes de confirmar.
    const zone = this.deps.resolveZone(this.pos, this.map.version);
    if (!zone || !zone.isPrivate || zone.id !== c.zoneId) {
      this.commit({ candidate: null });
      return this.evaluate();
    }
    const ctx: MediaContext = { kind: "PRIVATE_ROOM", zoneId: c.zoneId };
    this.commit({ state: "PRIVATE_ROOM", context: ctx, desired: ctx, candidate: null });
  }

  private cancelCandidate(): void {
    this.token++;
    if (this.timer != null) {
      this.timers.clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.snap.candidate) this.snap = { ...this.snap, candidate: null };
  }

  private commit(patch: Partial<MediaContextSnapshot>): void {
    const next = { ...this.snap, ...patch };
    if (
      next.state === this.snap.state &&
      sameContext(next.context, this.snap.context) &&
      sameContext(next.desired, this.snap.desired) &&
      next.candidate === this.snap.candidate &&
      next.error === this.snap.error
    ) {
      return;
    }
    const prev = this.snap;
    this.snap = next;
    if (!sameContext(prev.desired, next.desired)) {
      emitTelemetry(
        this.deps.telemetry,
        "CONTEXT_CHANGE_REQUESTED",
        ctxFields(next.desired, prev.desired, this.map?.version),
      );
    }
    if (!sameContext(prev.context, next.context)) {
      emitTelemetry(
        this.deps.telemetry,
        "CONTEXT_CHANGED",
        ctxFields(next.context, prev.context, this.map?.version),
      );
    }
    for (const l of this.listeners) l(next);
  }
}
