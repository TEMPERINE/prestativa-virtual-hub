import { useEffect, useRef } from "react";
import { Mic } from "lucide-react";

type Profile = { id: string; display_name: string; avatar_color: string };

export function RemoteVideoTiles({
  streams,
  profiles,
  speakingPeers,
}: {
  streams: Record<string, MediaStream>;
  profiles: Record<string, Profile>;
  speakingPeers: Record<string, boolean>;
}) {
  const entries = Object.entries(streams).filter(([, s]) => s.getVideoTracks().some((t) => t.enabled && t.readyState === "live"));

  // Always mount audio for ALL streams (so audio plays even without video)
  return (
    <>
      <HiddenAudioPlayers streams={streams} />
      {entries.length > 0 && (
        <div className="absolute top-20 right-4 z-[110] flex flex-col gap-2 pointer-events-none">
          {entries.map(([peerId, stream]) => {
            const profile = profiles[peerId];
            const speaking = speakingPeers[peerId];
            return (
              <div
                key={peerId}
                className={`relative w-44 h-32 rounded-xl overflow-hidden shadow-soft border-2 transition-colors ${
                  speaking ? "border-primary" : "border-white/20"
                }`}
                style={{ background: profile?.avatar_color ?? "#222" }}
              >
                <VideoEl stream={stream} />
                <div className="absolute bottom-0 inset-x-0 px-2 py-1 bg-black/50 text-white text-xs flex items-center gap-1">
                  {speaking && <Mic className="w-3 h-3 text-primary-foreground" />}
                  <span className="truncate">{profile?.display_name ?? "Convidado"}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

function VideoEl({ stream }: { stream: MediaStream }) {
  const ref = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    if (ref.current && ref.current.srcObject !== stream) ref.current.srcObject = stream;
  }, [stream]);
  return <video ref={ref} autoPlay playsInline muted className="w-full h-full object-cover" />;
}

function HiddenAudioPlayers({ streams }: { streams: Record<string, MediaStream> }) {
  return (
    <div className="hidden">
      {Object.entries(streams).map(([peerId, stream]) => (
        <AudioEl key={peerId} stream={stream} />
      ))}
    </div>
  );
}

function AudioEl({ stream }: { stream: MediaStream }) {
  const ref = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    if (ref.current && ref.current.srcObject !== stream) ref.current.srcObject = stream;
  }, [stream]);
  return <audio ref={ref} autoPlay playsInline />;
}
