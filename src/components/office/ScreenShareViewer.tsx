import { useEffect, useRef, useState } from "react";
import { Maximize2, Minimize2, X, MonitorUp } from "lucide-react";

type Profile = { id: string; display_name: string; avatar_color: string };

export function ScreenShareViewer({
  localStream,
  remoteStreams,
  profiles,
  onStopLocal,
}: {
  localStream: MediaStream | null;
  remoteStreams: Record<string, MediaStream>;
  profiles: Record<string, Profile>;
  onStopLocal: () => void;
}) {
  const remotes = Object.entries(remoteStreams).filter(([, s]) =>
    s.getVideoTracks().some((t) => t.readyState === "live"),
  );
  const hasLocal = !!localStream;
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  // Auto-pick first available stream
  useEffect(() => {
    const keys = [...(hasLocal ? ["__local__"] : []), ...remotes.map(([id]) => id)];
    if (!activeKey || !keys.includes(activeKey)) setActiveKey(keys[0] ?? null);
  }, [hasLocal, remotes, activeKey]);

  if (!hasLocal && remotes.length === 0) return null;

  const activeStream =
    activeKey === "__local__"
      ? localStream
      : activeKey
        ? remoteStreams[activeKey]
        : null;
  const activeLabel =
    activeKey === "__local__"
      ? "Sua tela"
      : activeKey
        ? `Tela de ${profiles[activeKey]?.display_name ?? "Convidado"}`
        : "";

  return (
    <div
      className={`absolute z-[115] pointer-events-auto transition-all ${
        expanded
          ? "inset-4"
          : "bottom-4 left-1/2 -translate-x-1/2 w-[520px] max-w-[90vw] h-[300px]"
      }`}
    >
      <div className="relative w-full h-full rounded-2xl overflow-hidden bg-black/80 border border-white/15 shadow-2xl flex flex-col">
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
                title="Parar de compartilhar"
              >
                Parar
              </button>
            )}
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="inline-flex w-6 h-6 items-center justify-center rounded-md hover:bg-white/10"
              title={expanded ? "Recolher" : "Expandir"}
            >
              {expanded ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>
        <div className="flex-1 relative bg-black">
          {activeStream && <ScreenEl stream={activeStream} muted={activeKey === "__local__"} />}
        </div>
        {(hasLocal ? 1 : 0) + remotes.length > 1 && (
          <div className="flex items-center gap-1 px-2 py-1 bg-black/60 overflow-x-auto">
            {hasLocal && (
              <Thumb
                label="Você"
                active={activeKey === "__local__"}
                onClick={() => setActiveKey("__local__")}
              />
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
      </div>
    </div>
  );
}

function Thumb({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`shrink-0 px-2 py-1 rounded-md text-[10px] truncate max-w-[140px] ${
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
  // suppress unused X import warning via referencing
  void X;
  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      muted={muted}
      className="w-full h-full object-contain bg-black"
    />
  );
}
