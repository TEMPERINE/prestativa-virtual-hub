import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";

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
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (videoRef.current && stream && videoRef.current.srcObject !== stream) {
      videoRef.current.srcObject = stream;
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

  if (!visible) return null;

  return (
    <div ref={wrapRef} className="relative flex items-center">
      <div className="w-20 h-12 rounded-lg overflow-hidden bg-black/40 border border-white/15 shadow-soft">
        {stream ? (
          <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
        ) : null}
      </div>
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
