import { useEffect, useMemo, useRef, useState } from "react";
import { Minimize2, MonitorUp, X } from "lucide-react";

type Profile = { id: string; display_name: string; avatar_color: string };
type Rect = { x1: number; y1: number; x2: number; y2: number };

export function ScreenShareViewer({
  localStream,
  remoteStreams,
  profiles,
  onStopLocal,
  anchorRect,
}: {
  localStream: MediaStream | null;
  remoteStreams: Record<string, MediaStream>;
  profiles: Record<string, Profile>;
  onStopLocal: () => void;
  anchorRect: Rect | null;
}) {
  const remotes = Object.entries(remoteStreams).filter(([, s]) =>
    s.getVideoTracks().some((t) => t.readyState === "live"),
  );
  const hasLocal = !!localStream;
  const [activeKey, setActiveKey] = useState<string | null>(null);
  // Meeting-style: full screen by default whenever there is a share.
  const [meetingMode, setMeetingMode] = useState(true);

  useEffect(() => {
    const keys = [...(hasLocal ? ["__local__"] : []), ...remotes.map(([id]) => id)];
    if (!activeKey || !keys.includes(activeKey)) setActiveKey(keys[0] ?? null);
  }, [hasLocal, remotes, activeKey]);

  // Whenever a new share starts (had none before, now has one), open meeting mode.
  const hadShareRef = useRef(false);
  useEffect(() => {
    const hasAny = hasLocal || remotes.length > 0;
    if (hasAny && !hadShareRef.current) setMeetingMode(true);
    hadShareRef.current = hasAny;
  }, [hasLocal, remotes.length]);

  // ESC exits meeting mode.
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

  const placement = useMemo(() => {
    if (!anchorRect) {
      return {
        left: "50%",
        top: "auto",
        bottom: "4%",
        width: "min(90%, 520px)",
        aspectRatio: "16 / 9",
        transform: "translateX(-50%)",
      } as const;
    }
    const cx = (anchorRect.x1 + anchorRect.x2) / 2;
    const zoneW = anchorRect.x2 - anchorRect.x1;
    const zoneH = anchorRect.y2 - anchorRect.y1;
    const widthPct = Math.max(22, Math.min(46, zoneW * 100 * 1.2));
    const dockInside = zoneH > 0.22;
    const topPct = dockInside ? (anchorRect.y1 + 0.015) * 100 : Math.max(2, anchorRect.y1 * 100 - 2);
    const halfW = widthPct / 2;
    const leftPct = Math.min(100 - halfW - 1, Math.max(halfW + 1, cx * 100));
    return {
      left: `${leftPct}%`,
      top: `${topPct}%`,
      width: `${widthPct}%`,
      aspectRatio: "16 / 9",
      transform: dockInside ? "translateX(-50%)" : "translate(-50%, -100%)",
    } as const;
  }, [anchorRect]);

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
    return (
      <div className="fixed inset-0 z-[200] bg-black/95 flex flex-col pointer-events-auto">
        <div className="flex items-center justify-between px-4 py-2 bg-black/80 text-white text-sm shrink-0 border-b border-white/10">
          <div className="flex items-center gap-2 min-w-0">
            <MonitorUp className="w-4 h-4 text-primary" />
            <span className="truncate font-medium">{activeLabel}</span>
            <span className="text-white/50 text-xs ml-2 hidden sm:inline">
              Pressione ESC para sair
            </span>
          </div>
          <div className="flex items-center gap-2">
            {hasLocal && (
              <button
                type="button"
                onClick={onStopLocal}
                className="px-3 py-1 rounded-md bg-red-500/90 hover:bg-red-500 text-white text-xs font-medium"
              >
                Parar compartilhamento
              </button>
            )}
            <button
              type="button"
              onClick={() => setMeetingMode(false)}
              className="inline-flex items-center gap-1 px-3 py-1 rounded-md bg-white/10 hover:bg-white/20 text-white text-xs"
              title="Sair do modo reunião (ESC)"
            >
              <Minimize2 className="w-3.5 h-3.5" />
              <span>Sair</span>
            </button>
          </div>
        </div>
        <div className="flex-1 relative bg-black min-h-0">
          {activeStream && <ScreenEl stream={activeStream} muted={activeKey === "__local__"} />}
        </div>
        {(hasLocal ? 1 : 0) + remotes.length > 1 && (
          <div className="flex items-center justify-center gap-2 px-3 py-2 bg-black/80 overflow-x-auto shrink-0 border-t border-white/10">
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
      </div>
    );
  }

  // Compact docked mode: small floating panel with a button to re-enter meeting mode.
  return (
    <div className="absolute z-[115] pointer-events-auto transition-all duration-300 ease-out" style={placement}>
      <div className="relative w-full h-full rounded-2xl overflow-hidden bg-black/85 border border-white/15 shadow-2xl flex flex-col min-h-0">
        <div className="flex items-center justify-between px-3 py-1.5 bg-black/60 text-white text-xs shrink-0">
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
              title="Entrar no modo reunião"
            >
              Abrir
            </button>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setMeetingMode(true)}
          className="flex-1 relative bg-black min-h-0 cursor-zoom-in"
          title="Abrir em modo reunião"
        >
          {activeStream && <ScreenEl stream={activeStream} muted={activeKey === "__local__"} />}
        </button>
        {(hasLocal ? 1 : 0) + remotes.length > 1 && (
          <div className="flex items-center gap-1 px-2 py-1 bg-black/60 overflow-x-auto shrink-0">
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
