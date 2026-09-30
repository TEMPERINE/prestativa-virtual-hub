import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

/**
 * Etapa 14D (Fase A) — template de gravação para o LiveKit Egress.
 * Aberto SOMENTE pelo Chrome headless do Egress, que acrescenta ?url=&token=.
 * Subscribe-only: não publica nada, não cria sessão/presence, sem controles.
 * Escritório/avatares/movimento entram na Fase B.
 */
export const Route = createFileRoute("/recording/$meetingId")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Gravação — Prestativa Office" },
      { name: "robots", content: "noindex" },
      { name: "description", content: "Composição de gravação de reunião." },
      { property: "og:title", content: "Gravação — Prestativa Office" },
      { property: "og:description", content: "Composição de gravação de reunião." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: RecordingTemplate,
});

interface Tile {
  key: string;
  name: string;
  track: MediaStreamTrack;
  source: "camera" | "screen";
}

function RecordingTemplate() {
  const [tiles, setTiles] = useState<Tile[]>([]);
  const audioHost = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const qs = new URLSearchParams(window.location.search);
    const url = qs.get("url");
    const token = qs.get("token");
    if (!url || !token) return;
    let disposed = false;
    let cleanup = () => {};
    void (async () => {
      const lk = await import("livekit-client");
      const room = new lk.Room({ adaptiveStream: false });
      const rebuild = () => {
        const out: Tile[] = [];
        for (const p of room.remoteParticipants.values()) {
          for (const pub of p.trackPublications.values()) {
            const t = pub.track;
            if (!t || pub.kind !== lk.Track.Kind.Video || pub.isMuted) continue;
            const screen = pub.source === lk.Track.Source.ScreenShare;
            if (!screen && pub.source !== lk.Track.Source.Camera) continue;
            out.push({
              key: `${p.identity}:${pub.trackSid}`,
              name: p.name || p.identity,
              track: t.mediaStreamTrack,
              source: screen ? "screen" : "camera",
            });
          }
        }
        if (!disposed) setTiles(out);
      };
      room
        .on(lk.RoomEvent.TrackSubscribed, (track) => {
          if (track.kind === lk.Track.Kind.Audio && audioHost.current) {
            audioHost.current.appendChild(track.attach());
          }
          rebuild();
        })
        .on(lk.RoomEvent.TrackUnsubscribed, (track) => {
          track.detach().forEach((el) => el.remove());
          rebuild();
        })
        .on(lk.RoomEvent.TrackMuted, rebuild)
        .on(lk.RoomEvent.TrackUnmuted, rebuild)
        .on(lk.RoomEvent.ParticipantDisconnected, rebuild)
        .on(lk.RoomEvent.Disconnected, () => console.log("END_RECORDING"));
      await room.connect(url, token, { autoSubscribe: true });
      rebuild();
      // Sinal exigido pelo Egress para começar a gravar.
      console.log("START_RECORDING");
      cleanup = () => void room.disconnect();
      if (disposed) cleanup();
    })();
    return () => {
      disposed = true;
      cleanup();
    };
  }, []);

  const screen = tiles.find((t) => t.source === "screen");
  const cams = tiles.filter((t) => t.source === "camera");

  return (
    <div className="fixed inset-0 bg-background text-foreground overflow-hidden">
      <div ref={audioHost} className="hidden" />
      {screen ? (
        <>
          <Video track={screen.track} className="absolute inset-0 w-full h-full object-contain bg-background" />
          <div className="absolute right-4 bottom-4 flex flex-col gap-2 w-64">
            {cams.slice(0, 4).map((c) => (
              <Cam key={c.key} tile={c} />
            ))}
          </div>
        </>
      ) : cams.length ? (
        <div
          className="grid gap-3 p-6 h-full content-center"
          style={{ gridTemplateColumns: `repeat(${Math.ceil(Math.sqrt(cams.length))}, minmax(0, 1fr))` }}
        >
          {cams.map((c) => (
            <Cam key={c.key} tile={c} />
          ))}
        </div>
      ) : (
        <div className="h-full grid place-items-center text-2xl text-muted-foreground">
          Prestativa Office — reunião em andamento
        </div>
      )}
    </div>
  );
}

function Cam({ tile }: { tile: Tile }) {
  return (
    <div className="relative aspect-video rounded-lg overflow-hidden bg-muted">
      <Video track={tile.track} className="w-full h-full object-cover" />
      <span className="absolute left-2 bottom-2 text-xs px-2 py-0.5 rounded bg-background/70">{tile.name}</span>
    </div>
  );
}

function Video({ track, className }: { track: MediaStreamTrack; className?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = new MediaStream([track]);
  }, [track]);
  return <video ref={ref} autoPlay muted playsInline className={className} />;
}
