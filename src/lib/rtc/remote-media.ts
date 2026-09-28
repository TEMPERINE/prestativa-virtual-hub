// RTC v2 Etapa 8 — RemoteMedia.
//
// Fonte única de verdade: room.remoteParticipants.
// Nunca deriva roster de positions/Presence/desiredPeers/videoVisibleIds/ownerId.
// participant.identity === userId (sem deduplicação por metadata/clientId).
// Não chama setSubscribed() e não monta <video>/<audio>.
//
// A cada evento relevante da Room anexada, o snapshot é recalculado a partir
// de room.remoteParticipants. Handlers ficam presos à Room que os registrou e
// são ignorados se ela não for mais a atual.

export type RemoteSource = "microphone" | "camera" | "screen_share" | "screen_share_audio";

export interface RemotePublicationLike {
  readonly trackSid: string;
  readonly source: string;
  readonly isSubscribed: boolean;
  readonly isMuted: boolean;
  readonly track?: unknown;
}

export interface RemoteParticipantLike {
  readonly identity: string;
  readonly trackPublications: Map<string, RemotePublicationLike>;
}

export interface RemoteRoomLike {
  readonly remoteParticipants: Map<string, RemoteParticipantLike>;
  on(event: string, fn: (...args: unknown[]) => void): unknown;
  off(event: string, fn: (...args: unknown[]) => void): unknown;
}

/** Valores idênticos aos de RoomEvent do livekit-client. */
export const REMOTE_MEDIA_EVENTS = [
  "participantConnected",
  "participantDisconnected",
  "trackPublished",
  "trackUnpublished",
  "trackSubscribed",
  "trackUnsubscribed",
  "trackMuted",
  "trackUnmuted",
  "trackSubscriptionStatusChanged",
] as const;

export interface RemoteTrackInfo {
  sid: string;
  subscribed: boolean;
  muted: boolean;
  track: unknown | null;
}

export interface RemoteParticipantState {
  identity: string;
  microphone: RemoteTrackInfo | null;
  camera: RemoteTrackInfo | null;
  screenShare: RemoteTrackInfo | null;
  screenShareAudio: RemoteTrackInfo | null;
}

export interface RemoteMediaSnapshot {
  participants: RemoteParticipantState[];
}

const SOURCE_KEY: Record<RemoteSource, keyof Omit<RemoteParticipantState, "identity">> = {
  microphone: "microphone",
  camera: "camera",
  screen_share: "screenShare",
  screen_share_audio: "screenShareAudio",
};

export function buildRemoteSnapshot(room: RemoteRoomLike | null): RemoteMediaSnapshot {
  if (!room) return { participants: [] };
  const participants: RemoteParticipantState[] = [];
  for (const p of room.remoteParticipants.values()) {
    const s: RemoteParticipantState = {
      identity: p.identity,
      microphone: null,
      camera: null,
      screenShare: null,
      screenShareAudio: null,
    };
    for (const pub of p.trackPublications.values()) {
      const key = SOURCE_KEY[pub.source as RemoteSource];
      if (!key) continue;
      s[key] = {
        sid: pub.trackSid,
        subscribed: pub.isSubscribed,
        muted: pub.isMuted,
        track: pub.isSubscribed ? (pub.track ?? null) : null,
      };
    }
    participants.push(s);
  }
  participants.sort((a, b) => (a.identity < b.identity ? -1 : a.identity > b.identity ? 1 : 0));
  return { participants };
}

export class RemoteMedia {
  private room: RemoteRoomLike | null = null;
  private handler: (() => void) | null = null;
  private snapshot: RemoteMediaSnapshot = { participants: [] };
  private listeners = new Set<(s: RemoteMediaSnapshot) => void>();

  getSnapshot(): RemoteMediaSnapshot {
    return this.snapshot;
  }

  subscribe(fn: (s: RemoteMediaSnapshot) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  attachRoom(room: RemoteRoomLike): void {
    if (this.room === room) return;
    if (this.room) this.detachRoom(this.room);
    this.room = room;
    const handler = () => {
      if (this.room !== room) return; // evento atrasado da Room antiga
      this.refresh();
    };
    this.handler = handler;
    for (const ev of REMOTE_MEDIA_EVENTS) room.on(ev, handler);
    this.refresh(); // roster inicial: participantes já presentes
  }

  detachRoom(room: RemoteRoomLike): void {
    if (this.room !== room) return;
    if (this.handler) for (const ev of REMOTE_MEDIA_EVENTS) room.off(ev, this.handler);
    this.handler = null;
    this.room = null;
    this.refresh();
  }

  dispose(): void {
    if (this.room) this.detachRoom(this.room);
    this.listeners.clear();
  }

  private refresh() {
    this.snapshot = buildRemoteSnapshot(this.room);
    for (const fn of this.listeners) fn(this.snapshot);
  }
}
