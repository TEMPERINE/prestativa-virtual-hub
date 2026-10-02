// RTC v2 Etapa 9 — SpatialSubscriptions do LOBBY.
//
// Único módulo do RTC v2 autorizado a chamar RemoteTrackPublication.setSubscribed().
// Atua SOMENTE quando o contexto é LOBBY (Room conectada com autoSubscribe:false).
// Em PRIVATE_ROOM não participa: attachRoom com contexto != LOBBY apenas desanexa.
//
// Decisão por participante, usando apenas: posição própria + posição daquele
// participante (identity === userId). Sem zonas, desiredPeers, videoVisibleIds,
// ownerId/clientId ou posições de terceiros.
//
// Histerese: FORA → entra se dist <= CONNECT_RADIUS; DENTRO → sai se dist > DISCONNECT_RADIUS.
// setSubscribed só é chamado quando a decisão aplicada àquela publication muda.
//
// Não ligado ao produto. RTC v1 permanece intocado.

import type { MediaContext } from "./media-context";

/**
 * Coordenadas do Office são normalizadas (fração 0..1 da largura/altura do mapa).
 * CONNECT_RADIUS preservado do lobby do RTC v1 (OfficeScene PROXIMITY_CONNECT).
 */
export const CONNECT_RADIUS = 0.038;
/** Margem preservada do lobby atual do Prestativa Office. */
export const DISCONNECT_RADIUS = 0.052;

export interface Position {
  x: number;
  y: number;
}

/** Mesma métrica do lobby atual: distância euclidiana (Math.hypot) em coords normalizadas. */
export function spatialDistance(a: Position, b: Position): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/**
 * Critério geométrico ÚNICO (histerese) — usado pelo SpatialSubscriptions e
 * pela decisão de acordar o lobby (RTC On Demand). Nunca duplicar raios.
 */
export function withinSpatialRange(
  dist: number,
  wasInside: boolean,
  connectR = CONNECT_RADIUS,
  disconnectR = DISCONNECT_RADIUS,
): boolean {
  return wasInside ? dist <= disconnectR : dist <= connectR;
}

/** Conjunto de userIds próximos, aplicando a mesma histerese. Pura. */
export function computeNearby(
  local: Position | null,
  remotes: Iterable<[string, Position]>,
  prevInside: ReadonlySet<string>,
): Set<string> {
  const out = new Set<string>();
  if (!local) return out;
  for (const [uid, pos] of remotes) {
    if (withinSpatialRange(spatialDistance(local, pos), prevInside.has(uid))) out.add(uid);
  }
  return out;
}

export interface SubscribablePublicationLike {
  readonly trackSid: string;
  readonly source?: string;
  setSubscribed(subscribed: boolean): void;
}

export interface SpatialParticipantLike {
  readonly identity: string;
  readonly trackPublications: Map<string, SubscribablePublicationLike>;
}

export interface SpatialRoomLike {
  readonly remoteParticipants: Map<string, SpatialParticipantLike>;
  on(event: string, fn: (...args: unknown[]) => void): unknown;
  off(event: string, fn: (...args: unknown[]) => void): unknown;
}

/** Valores idênticos a RoomEvent do livekit-client. */
export const SPATIAL_EVENTS = [
  "participantConnected",
  "participantDisconnected",
  "trackPublished",
  "trackUnpublished",
] as const;

export interface SpatialOptions {
  connectRadius?: number;
  disconnectRadius?: number;
}

export class SpatialSubscriptions {
  private readonly connectR: number;
  private readonly disconnectR: number;
  private room: SpatialRoomLike | null = null;
  private handlers: Array<[string, (...a: unknown[]) => void]> = [];
  private local: Position | null = null;
  private remote = new Map<string, Position>();
  /** userIds atualmente DENTRO do alcance (estado da histerese). */
  private inside = new Set<string>();
  /** Última decisão aplicada por publication. */
  private applied = new Map<SubscribablePublicationLike, boolean>();
  private disposed = false;

  constructor(opts: SpatialOptions = {}) {
    this.connectR = opts.connectRadius ?? CONNECT_RADIUS;
    this.disconnectR = opts.disconnectRadius ?? DISCONNECT_RADIUS;
    if (!(this.connectR < this.disconnectR)) {
      throw new Error("CONNECT_RADIUS deve ser menor que DISCONNECT_RADIUS");
    }
  }

  // ---------- room ----------
  attachRoom(room: SpatialRoomLike, context: MediaContext): void {
    if (this.disposed) return;
    if (context.kind !== "LOBBY") {
      if (this.room) this.detachRoom(this.room);
      return;
    }
    if (this.room === room) return;
    if (this.room) this.detachRoom(this.room);
    this.room = room;
    const guard =
      (fn: (...a: unknown[]) => void) =>
      (...a: unknown[]) => {
        if (this.disposed || this.room !== room) return; // Room antiga
        fn(...a);
      };
    const onParticipant = guard((p) => this.reconcileParticipant(p as SpatialParticipantLike));
    const onDisconnected = guard((p) => this.forgetParticipant(p as SpatialParticipantLike));
    const onPublished = guard((_pub, p) => this.reconcileParticipant(p as SpatialParticipantLike));
    const onUnpublished = guard((pub) => {
      this.applied.delete(pub as SubscribablePublicationLike);
    });
    this.handlers = [
      ["participantConnected", onParticipant],
      ["participantDisconnected", onDisconnected],
      ["trackPublished", onPublished],
      ["trackUnpublished", onUnpublished],
    ];
    for (const [ev, fn] of this.handlers) room.on(ev, fn);
    this.reconcileAll(); // participantes/publications já existentes
  }

  detachRoom(room: SpatialRoomLike): void {
    if (this.room !== room) return;
    for (const [ev, fn] of this.handlers) room.off(ev, fn);
    this.handlers = [];
    this.room = null;
    this.inside.clear();
    this.applied.clear();
  }

  // ---------- posições ----------
  setLocalPosition(pos: Position | null): void {
    if (this.disposed) return;
    this.local = pos ? { x: pos.x, y: pos.y } : null;
    this.reconcileAll();
  }

  setRemotePosition(userId: string, pos: Position): void {
    if (this.disposed) return;
    this.remote.set(userId, { x: pos.x, y: pos.y });
    const p = this.room?.remoteParticipants.get(userId);
    if (p) this.reconcileParticipant(p);
  }

  removeRemotePosition(userId: string): void {
    if (this.disposed) return;
    this.remote.delete(userId);
    const p = this.room?.remoteParticipants.get(userId);
    if (p) this.reconcileParticipant(p);
  }

  /** userIds considerados dentro do alcance (diagnóstico/testes). */
  getInRange(): string[] {
    return [...this.inside].sort();
  }

  dispose(): void {
    if (this.room) this.detachRoom(this.room);
    this.disposed = true;
    this.remote.clear();
    this.local = null;
  }

  // ---------- núcleo ----------
  private reconcileAll() {
    const room = this.room;
    if (!room) return;
    for (const p of room.remoteParticipants.values()) this.reconcileParticipant(p);
  }

  private decide(userId: string): boolean {
    const me = this.local;
    const them = this.remote.get(userId);
    if (!me || !them) return false; // sem posição → fora, por segurança
    const d = spatialDistance(me, them);
    return withinSpatialRange(d, this.inside.has(userId), this.connectR, this.disconnectR);
  }

  private reconcileParticipant(p: SpatialParticipantLike) {
    if (!this.room || this.room.remoteParticipants.get(p.identity) !== p) return;
    const want = this.decide(p.identity);
    if (want) this.inside.add(p.identity);
    else this.inside.delete(p.identity);
    for (const pub of p.trackPublications.values()) {
      const prev = this.applied.get(pub);
      // Publication nova em participante FORA: já nasce unsubscribed (autoSubscribe:false).
      if (prev === undefined && !want) {
        this.applied.set(pub, false);
        continue;
      }
      if (prev === want) continue;
      this.applied.set(pub, want);
      pub.setSubscribed(want);
    }
  }

  private forgetParticipant(p: SpatialParticipantLike) {
    this.inside.delete(p.identity);
    for (const pub of p.trackPublications.values()) this.applied.delete(pub);
  }
}
