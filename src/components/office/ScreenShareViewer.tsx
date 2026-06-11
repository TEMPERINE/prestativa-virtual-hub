import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Mic, MicOff, Minimize2, MonitorUp, VideoOff } from "lucide-react";

type Profile = { id: string; display_name: string; avatar_color: string };

type Participant = {
  id: string;
  profile: Profile;
  stream: MediaStream | null;
  hasVideo: boolean;
  micOn: boolean;
  speaking: boolean;
  isSelf?: boolean;
};

export function ScreenShareViewer({
  localStream,
  remoteStreams,
  profiles,
  onStopLocal,
  participants = [],
}: {
  localStream: MediaStream | null;
  remoteStreams: Record<string, MediaStream>;
  profiles: Record<string, Profile>;
  onStopLocal: () => void;
  participants?: Participant[];
  /** Mantido para compatibilidade — ignorado nesta versão (full screen sempre). */
  anchorRect?: unknown;
}) {
  const remotes = Object.entries(remoteStreams).filter(([, s]) =>
    s.getVideoTracks().some((t) => t.readyState === "live"),
  );
  const hasLocal = !!localStream;
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [meetingMode, setMeetingMode] = useState(true);

  useEffect(() => {
    const keys = [...(hasLocal ? ["__local__"] : []), ...remotes.map(([id]) => id)];
    if (!activeKey || !keys.includes(activeKey)) setActiveKey(keys[0] ?? null);
  }, [hasLocal, remotes, activeKey]);

  const hadShareRef = useRef(false);
  useEffect(() => {
    const hasAny = hasLocal || remotes.length > 0;
    if (hasAny && !hadShareRef.current) setMeetingMode(true);
    if (!hasAny) setMeetingMode(true); // resetar p/ próxima vez
    hadShareRef.current = hasAny;
  }, [hasLocal, remotes.length]);

  useEffect(() => {
    if (!meetingMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setMeetingMode(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [meetingMode]);

  if (!hasLocal && remotes.length === 0) return null;

  const activeStream =
    activeKey === "__local__" ? localStream : activeKey ? remoteStreams[activeKey] : null;
  const activeLabel =
    activeKey === "__local__"
      ? "Sua tela"
      : activeKey
        ? `Tela de ${profiles[activeKey]?.display_name ?? "Convidado"}`
        : "";

  if (meetingMode) {
    const overlay = (
      <div
        className="fixed inset-x-0 bottom-0 flex flex-col pointer-events-auto"
        style={{ zIndex: 2147483600, top: 64 }}
      >
        {/* Backdrop 50% sobre o cenário (abaixo da barra superior, para não cobrir os controles) */}
        <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

        {/* Header da reunião */}
        <div className="relative flex items-center justify-between px-4 py-2.5 bg-black/85 text-white shrink-0 border-b border-white/10">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center">
              <MonitorUp className="w-4 h-4 text-primary" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-medium truncate">{activeLabel}</div>
              <div className="text-[11px] text-white/55">Modo reunião • ESC para sair</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {hasLocal && (
              <button
                type="button"
                onClick={onStopLocal}
                className="px-3 py-1.5 rounded-md bg-red-500/90 hover:bg-red-500 text-white text-xs font-medium"
              >
                Parar compartilhamento
              </button>
            )}
            <button
              type="button"
              onClick={() => setMeetingMode(false)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-white/10 hover:bg-white/20 text-white text-xs"
              title="Sair do modo reunião (ESC)"
            >
              <Minimize2 className="w-3.5 h-3.5" />
              <span>Sair</span>
            </button>
          </div>
        </div>

        {/* Palco com vídeo principal */}
        <div className="relative flex-1 min-h-0 p-4">
          <div className="w-full h-full rounded-xl overflow-hidden bg-black border border-white/10 shadow-2xl relative">
            {activeStream && <ScreenEl stream={activeStream} muted={activeKey === "__local__"} />}
          </div>
        </div>

        {/* Seletor de telas (quando há mais de uma) */}
        {(hasLocal ? 1 : 0) + remotes.length > 1 && (
          <div className="relative flex items-center justify-center gap-2 px-3 pb-2 shrink-0">
            {hasLocal && (
              <Thumb label="Você" active={activeKey === "__local__"} onClick={() => setActiveKey("__local__")} />
            )}
            {remotes.map(([id]) => (
              <Thumb
                key={id}
                label={profiles[id]?.display_name ?? "Convidado"}
                active={activeKey === id}
                onClick={() => setActiveKey(id)}
              />
            ))}
          </div>
        )}

        {/* Faixa de participantes (estilo Meet) */}
        {participants.length > 0 && (
          <div className="relative shrink-0 px-3 pb-3">
            <div className="flex items-center gap-2 overflow-x-auto py-1">
              {participants.map((p) => (
                <ParticipantTile key={p.id} p={p} />
              ))}
            </div>
          </div>
        )}
      </div>
    );

    if (typeof document !== "undefined") {
      return createPortal(overlay, document.body);
    }
    return overlay;
  }

  // Modo compacto: pequeno painel flutuante no canto inferior central.
  const compact = (
    <div
      className="fixed bottom-4 left-1/2 -translate-x-1/2 pointer-events-auto"
      style={{ zIndex: 2147483500, width: "min(420px, 90vw)" }}
    >
      <div className="rounded-2xl overflow-hidden bg-black/85 border border-white/15 shadow-2xl flex flex-col">
        <div className="flex items-center justify-between px-3 py-1.5 bg-black/60 text-white text-xs">
          <div className="flex items-center gap-2 min-w-0">
            <MonitorUp className="w-3.5 h-3.5 text-primary" />
            <span className="truncate">{activeLabel}</span>
          </div>
          <div className="flex items-center gap-1">
            {hasLocal && (
              <button
                type="button"
                onClick={onStopLocal}
                className="px-2 py-0.5 rounded-md bg-red-500/80 hover:bg-red-500 text-white text-[10px]"
              >
                Parar
              </button>
            )}
            <button
              type="button"
              onClick={() => setMeetingMode(true)}
              className="px-2 py-0.5 rounded-md bg-primary/90 hover:bg-primary text-primary-foreground text-[10px] font-medium"
            >
              Abrir
            </button>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setMeetingMode(true)}
          className="relative bg-black aspect-video cursor-zoom-in"
          title="Abrir em modo reunião"
        >
          {activeStream && <ScreenEl stream={activeStream} muted={activeKey === "__local__"} />}
        </button>
      </div>
    </div>
  );

  if (typeof document !== "undefined") {
    return createPortal(compact, document.body);
  }
  return compact;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function ParticipantTile({ p }: { p: Participant }) {
  return (
    <div
      className={`relative w-40 h-24 rounded-lg overflow-hidden shrink-0 border-2 transition-colors ${
        p.speaking ? "border-primary" : "border-white/15"
      }`}
      style={{ background: p.profile.avatar_color || "#1f2937" }}
    >
      {p.hasVideo && p.stream ? (
        <VideoEl stream={p.stream} mirrored={!!p.isSelf} />
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/40">
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-semibold"
            style={{ background: p.profile.avatar_color || "#475569" }}
          >
            {initials(p.profile.display_name)}
          </div>
          <div className="flex items-center gap-1 text-[10px] text-white/80">
            <VideoOff className="w-3 h-3" />
            <span>sem vídeo</span>
          </div>
        </div>
      )}
      <div className="absolute bottom-0 inset-x-0 px-2 py-1 bg-black/55 text-white text-[11px] flex items-center gap-1.5">
        {p.micOn ? (
          <Mic className={`w-3 h-3 shrink-0 ${p.speaking ? "text-primary" : "text-white/80"}`} />
        ) : (
          <MicOff className="w-3 h-3 shrink-0 text-red-400" />
        )}
        <span className="truncate">
          {p.profile.display_name}
          {p.isSelf ? " (você)" : ""}
        </span>
      </div>
    </div>
  );
}

function Thumb({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`shrink-0 px-2.5 py-1 rounded-md text-[11px] truncate max-w-[160px] ${
        active ? "bg-primary text-primary-foreground" : "bg-white/10 text-white/80 hover:bg-white/20"
      }`}
    >
      {label}
    </button>
  );
}

function ScreenEl({ stream, muted }: { stream: MediaStream; muted: boolean }) {
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
      muted={muted}
      className="absolute inset-0 w-full h-full object-contain bg-black"
    />
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
