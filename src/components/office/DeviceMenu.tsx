import { useEffect, useRef, useState } from "react";
import { ChevronDown, Check } from "lucide-react";

type Section = {
  label: string;
  devices: MediaDeviceInfo[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  fallbackLabel: string;
};

export function DeviceMenu({
  title,
  sections,
}: {
  title: string;
  sections: Section[];
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const hasAny = sections.some((s) => s.devices.length > 0);

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={title}
        className="inline-flex items-center justify-center w-5 h-9 rounded-md text-foreground/60 hover:text-foreground hover:bg-foreground/10 transition"
      >
        <ChevronDown className="w-3.5 h-3.5" />
      </button>
      {open && (
        <div className="absolute top-full right-0 mt-1 min-w-[260px] max-w-[320px] bg-popover text-popover-foreground rounded-lg shadow-soft border border-border z-[140] p-1">
          {!hasAny && (
            <div className="px-3 py-2 text-xs text-muted-foreground">
              Nenhum dispositivo encontrado. Conceda permissão e tente novamente.
            </div>
          )}
          {sections.map((section, i) =>
            section.devices.length > 0 ? (
              <div key={section.label} className={i > 0 ? "border-t border-border mt-1 pt-1" : ""}>
                <div className="px-2.5 py-1 text-[10px] font-semibold tracking-wide uppercase text-muted-foreground">
                  {section.label}
                </div>
                {section.devices.map((d) => {
                  const active = d.deviceId === section.selectedId;
                  return (
                    <button
                      key={d.deviceId}
                      type="button"
                      onClick={() => {
                        section.onSelect(d.deviceId);
                        setOpen(false);
                      }}
                      className={`w-full text-left text-xs px-2.5 py-1.5 rounded-md hover:bg-accent flex items-center gap-2 ${
                        active ? "bg-accent/60 font-medium" : ""
                      }`}
                    >
                      <Check
                        className={`w-3.5 h-3.5 shrink-0 ${active ? "opacity-100 text-primary" : "opacity-0"}`}
                      />
                      <span className="truncate">{d.label || section.fallbackLabel}</span>
                    </button>
                  );
                })}
              </div>
            ) : null,
          )}
        </div>
      )}
    </div>
  );
}
