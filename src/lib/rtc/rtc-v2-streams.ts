/**
 * RTC v2 — Etapa 12: montagem de MediaStream para a UI existente.
 * Usa SOMENTE tracks reais já existentes (LiveKit remoto / LocalMedia);
 * nunca inicia captura. Reaproveita o mesmo MediaStream enquanto o conjunto
 * de tracks não muda, para a UI não reanexar <video>/<audio> a cada evento.
 */
import type { RemoteMediaSnapshot, RemoteTrackInfo } from "./remote-media";

export interface TrackLike {
  readonly id: string;
}

export type StreamFactory<S> = (tracks: MediaStreamTrack[]) => S;

function mst(info: RemoteTrackInfo | null): MediaStreamTrack | null {
  if (!info || !info.subscribed || !info.track) return null;
  const t = (info.track as { mediaStreamTrack?: MediaStreamTrack }).mediaStreamTrack;
  return t ?? null;
}

export class StreamCache<S> {
  private entries = new Map<string, { sig: string; stream: S }>();
  constructor(private readonly make: StreamFactory<S>) {}

  get(key: string, tracks: MediaStreamTrack[]): S | null {
    if (tracks.length === 0) {
      this.entries.delete(key);
      return null;
    }
    const sig = tracks.map((t) => t.id).join("|");
    const cur = this.entries.get(key);
    if (cur && cur.sig === sig) return cur.stream;
    const stream = this.make(tracks);
    this.entries.set(key, { sig, stream });
    return stream;
  }

  retain(keys: Set<string>): void {
    for (const k of [...this.entries.keys()]) if (!keys.has(k)) this.entries.delete(k);
  }
}

/**
 * remoteStreams[userId] = microfone + câmera; remoteScreenStreams[userId] = tela.
 * `allowed` = participantes com mídia autorizada (PRIVATE_ROOM: todos da Room;
 * LOBBY: em alcance). identity === userId.
 */
export function buildRemoteStreams<S>(
  snap: RemoteMediaSnapshot,
  allowed: ReadonlySet<string>,
  av: StreamCache<S>,
  screens: StreamCache<S>,
): { remoteStreams: Record<string, S>; remoteScreenStreams: Record<string, S> } {
  const remoteStreams: Record<string, S> = {};
  const remoteScreenStreams: Record<string, S> = {};
  const keys = new Set<string>();
  for (const p of snap.participants) {
    if (!allowed.has(p.identity)) continue;
    keys.add(p.identity);
    const a = av.get(
      p.identity,
      [mst(p.microphone), mst(p.camera)].filter((t): t is MediaStreamTrack => !!t),
    );
    if (a) remoteStreams[p.identity] = a;
    const s = screens.get(
      p.identity,
      [mst(p.screenShare), mst(p.screenShareAudio)].filter((t): t is MediaStreamTrack => !!t),
    );
    if (s) remoteScreenStreams[p.identity] = s;
  }
  av.retain(keys);
  screens.retain(keys);
  return { remoteStreams, remoteScreenStreams };
}
