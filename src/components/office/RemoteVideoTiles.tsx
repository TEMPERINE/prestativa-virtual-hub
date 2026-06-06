import { useEffect, useRef } from "react";
import { Mic, MicOff, VideoOff } from "lucide-react";

type Profile = { id: string; display_name: string; avatar_color: string };

type Props = {
  // Self
  myId: string | null;
  myProfile: Profile | null;
  localStream: MediaStream | null;
  localCamOn: boolean;
  localMicOn: boolean;
  // Remotes
  streams: Record<string, MediaStream>;
  profiles: Record<string, Profile>;
  speakingPeers: Record<string, boolean>;
  connectedPeers: string[];
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function hasLiveVideo(stream: MediaStream | null | undefined): boolean {
  if (!stream) return false;
  return stream.getVideoTracks().some((t) => t.enabled && t.readyState === "live" && !t.muted);
}

export function RemoteVideoTiles({
  myId,
  myProfile,
  localStream,
  localCamOn,
  localMicOn,
  streams,
  profiles,
  speakingPeers,
  connectedPeers,
}: Props) {
  // Hidden audio for all remotes (audio plays even without video).
  // We render the strip only if at least one tile exists (always true once
  // user is identified — the local tile is always present in a call).
  const hasAnyone = !!myId && (connectedPeers.length > 0 || localCamOn || localMicOn);

  return (
    <>
      <HiddenAudioPlayers streams={streams} />
      {hasAnyone && (
        <div
          className="absolute right-3 z-[110] flex flex-col gap-2 pointer-events-none"
          style={{ top: "5.25rem", maxHeight: "calc(100vh - 6rem)" }}
        >
          <div className="flex flex-col gap-2 overflow-y-auto pr-1 pointer-events-auto">
            {/* Self tile */}
            {myProfile && (
              <Tile
                profile={myProfile}
                stream={localStream}
                hasVideo={localCamOn && hasLiveVideo(localStream)}
                micOn={localMicOn}
                speaking={false}
                isSelf
              />
            )}
            {/* Remote tiles */}
            {connectedPeers.map((peerId) => {
              const profile = profiles[peerId] ?? {
                id: peerId,
                display_name: "Convidado",
                avatar_color: "#475569",
              };
              const stream = streams[peerId];
              return (
                <Tile
                  key={peerId}
                  profile={profile}
                  stream={stream ?? null}
                  hasVideo={hasLiveVideo(stream)}
                  // We don't get remote mic state directly; infer from
                  // speaking detection (false when quiet doesn't mean muted).
                  micOn={true}
                  speaking={!!speakingPeers[peerId]}
                />
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}

function Tile({
  profile,
  stream,
  hasVideo,
  micOn,
  speaking,
  isSelf,
}: {
  profile: Profile;
  stream: MediaStream | null;
  hasVideo: boolean;
  micOn: boolean;
  speaking: boolean;
  isSelf?: boolean;
}) {
  return (
    <div
      className={`relative w-48 h-28 rounded-xl overflow-hidden shadow-lg border-2 transition-colors ${
        speaking ? "border-primary" : "border-white/15"
      }`}
      style={{ background: profile.avatar_color || "#1f2937" }}
    >
      {hasVideo && stream ? (
        <VideoEl stream={stream} mirrored={!!isSelf} />
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/35">
          <div
            className="w-12 h-12 rounded-full flex items-center justify-center text-white text-base font-semibold shadow-inner"
            style={{ background: profile.avatar_color || "#475569" }}
          >
            {initials(profile.display_name)}
          </div>
          <div className="flex items-center gap-1 text-[10px] text-white/85">
            <VideoOff className="w-3 h-3" />
            <span>sem vídeo</span>
          </div>
        </div>
      )}

      {/* Bottom name + mic state bar (Meet-like) */}
      <div className="absolute bottom-0 inset-x-0 px-2 py-1 bg-black/55 text-white text-xs flex items-center gap-1.5">
        {micOn ? (
          <Mic className={`w-3 h-3 shrink-0 ${speaking ? "text-primary" : "text-white/80"}`} />
        ) : (
          <MicOff className="w-3 h-3 shrink-0 text-red-400" />
        )}
        <span className="truncate">
          {profile.display_name}
          {isSelf ? " (você)" : ""}
        </span>
      </div>
    </div>
  );
}

function VideoEl({ stream, mirrored }: { stream: MediaStream; mirrored?: boolean }) {
  const ref = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    if (ref.current && ref.current.srcObject !== stream) {
      ref.current.srcObject = stream;
      ref.current.play?.().catch(() => {});
    }
  }, [stream]);
  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      muted
      className="w-full h-full object-cover"
      style={mirrored ? { transform: "scaleX(-1)" } : undefined}
    />
  );
}

function HiddenAudioPlayers({ streams }: { streams: Record<string, MediaStream> }) {
  return (
    <div className="absolute -left-[9999px] top-0 w-px h-px overflow-hidden" aria-hidden>
      {Object.entries(streams).map(([peerId, stream]) => (
        <AudioEl key={peerId} stream={stream} />
      ))}
    </div>
  );
}

function AudioEl({ stream }: { stream: MediaStream }) {
  const ref = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    if (!ref.current) return;
    if (ref.current.srcObject !== stream) ref.current.srcObject = stream;
    void ref.current.play().catch(() => {});
  }, [stream]);
  return <audio ref={ref} autoPlay playsInline />;
}
