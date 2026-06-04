import { useEffect, useRef, useState } from "react";
import { ChevronDown, X } from "lucide-react";

export function CamPreviewAndPicker({
  stream,
  devices,
  selectedId,
  onSelect,
  visible,
}: {
  stream: MediaStream | null;
  devices: MediaDeviceInfo[];
  selectedId: string | null;
  onSelect: (deviceId: string) => void;
  visible: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const expandedVideoRef = useRef<HTMLVideoElement | null>(null);
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const autoCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (videoRef.current && stream && videoRef.current.srcObject !== stream) {
      videoRef.current.srcObject = stream;
    }
    if (expandedVideoRef.current && stream && expandedVideoRef.current.srcObject !== stream) {
      expandedVideoRef.current.srcObject = stream;
    }
  }, [stream]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const handleExpand = () => {
    if (!stream) return;
    setExpanded(true);
    setOpen(false);
    if (autoCloseTimer.current) clearTimeout(autoCloseTimer.current);
    autoCloseTimer.current = setTimeout(() => {
      setExpanded(false);
    }, 8000);
  };

  const handleClose = () => {
    if (autoCloseTimer.current) clearTimeout(autoCloseTimer.current);
    autoCloseTimer.current = null;
    setExpanded(false);
  };

  useEffect(() => {
    return () => {
      if (autoCloseTimer.current) clearTimeout(autoCloseTimer.current);
    };
  }, []);

  if (!visible) return null;

  return (
    <div ref={wrapRef} className="relative flex items-center">
      {/* Collapsed preview — clickable */}
      {!expanded && (
        <button
          type="button"
          onClick={handleExpand}
          className="w-20 h-12 rounded-lg overflow-hidden bg-black/40 border border-white/15 shadow-soft cursor-pointer hover:ring-2 hover:ring-primary/60 transition"
          title="Clique para expandir a prévia"
        >
          {stream ? (
            <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover pointer-events-none" />
          ) : null}
        </button>
      )}

      {/* Expanded preview */}
      {expanded && (
        <div className="absolute right-0 top-full mt-2 rounded-xl overflow-hidden bg-black/80 border border-white/20 shadow-2xl z-[130]"
          style={{ width: 320, height: 180 }}
        >
          <video
            ref={expandedVideoRef}
            autoPlay
            playsInline
            muted
            className="w-full h-full object-cover"
          />
          <button
            type="button"
            onClick={handleClose}
            className="absolute top-2 right-2 inline-flex items-center justify-center w-7 h-7 rounded-full bg-black/60 text-white/90 hover:bg-black/80 transition"
            title="Fechar"
          >
            <X className="w-4 h-4" />
          </button>
          <div className="absolute bottom-2 left-2 text-[10px] text-white/70 bg-black/50 px-2 py-0.5 rounded-full">
            Prévia da câmera
          </div>
        </div>
      )}

      {devices.length > 1 && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="ml-1 inline-flex items-center justify-center w-6 h-12 rounded-md text-white/80 hover:bg-white/10"
          title="Selecionar câmera"
        >
          <ChevronDown className="w-4 h-4" />
        </button>
      )}
      {open && devices.length > 0 && (
        <div className="absolute top-full right-0 mt-1 min-w-[220px] bg-popover text-popover-foreground rounded-lg shadow-soft border border-border z-[120] p-1">
          {devices.map((d) => (
            <button
              key={d.deviceId}
              type="button"
              onClick={() => { onSelect(d.deviceId); setOpen(false); }}
              className={`w-full text-left text-xs px-2 py-1.5 rounded-md hover:bg-accent ${
                d.deviceId === selectedId ? "bg-accent font-medium" : ""
              }`}
            >
              {d.label || `Câmera ${d.deviceId.slice(0, 6)}`}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
