import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  CELEBRATION_MAX_LEN, CELEBRATION_REASONS, canSubmitCelebration, type CelebrationReason,
} from "@/lib/office/bell-celebration";

type Props = {
  leftPct: number;
  topPct: number;
  onRingOnly: () => void;
  onCelebrate: (reason: CelebrationReason | null, message: string) => void;
  onClose: () => void;
};

/** Popover ancorado no sino: "Apenas tocar" ou "Informar motivo". */
export function BellPopover({ leftPct, topPct, onRingOnly, onCelebrate, onClose }: Props) {
  const [mode, setMode] = useState<"menu" | "compose">("menu");
  const [reason, setReason] = useState<CelebrationReason | null>(null);
  const [msg, setMsg] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); onClose(); } };
    const onDown = (e: PointerEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("pointerdown", onDown); };
  }, [onClose]);

  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  const valid = canSubmitCelebration(msg);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Tocar o sino"
      onPointerDown={stop} onMouseDown={stop} onClick={stop} onKeyDown={stop}
      className="absolute -translate-x-1/2 -translate-y-full w-72 rounded-xl border bg-popover text-popover-foreground shadow-2xl p-3 animate-in fade-in zoom-in-95"
      style={{ left: `${leftPct}%`, top: `calc(${topPct}% - 8px)`, zIndex: 1_000_001, fontFamily: "ui-sans-serif, system-ui, sans-serif" }}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm font-semibold">{mode === "menu" ? "Tocar o sino" : "O que vamos comemorar?"}</div>
        <button type="button" aria-label="Fechar" onClick={onClose} className="rounded p-1 text-muted-foreground hover:bg-muted">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      {mode === "menu" ? (
        <div className="flex flex-col gap-2">
          <Button variant="secondary" size="sm" onClick={onRingOnly}>Apenas tocar</Button>
          <Button size="sm" onClick={() => setMode("compose")}>✨ Informar motivo</Button>
        </div>
      ) : (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => { e.preventDefault(); if (valid) onCelebrate(reason, msg); }}
        >
          <div className="flex flex-wrap gap-1.5">
            {CELEBRATION_REASONS.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setReason(reason === r.id ? null : r.id)}
                className={`text-xs px-2 py-1 rounded-full border ${reason === r.id ? "bg-primary text-primary-foreground border-primary" : "hover:bg-muted"}`}
              >
                {r.label}
              </button>
            ))}
          </div>
          <textarea
            autoFocus
            value={msg}
            maxLength={CELEBRATION_MAX_LEN}
            onChange={(e) => setMsg(e.target.value)}
            onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (valid) onCelebrate(reason, msg); } }}
            placeholder="Ex.: Parabéns pelo elogio, Fram!"
            rows={3}
            className="w-full resize-none rounded-md border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground">{msg.length}/{CELEBRATION_MAX_LEN}</span>
            <Button type="submit" size="sm" disabled={!valid}>🔔 Tocar e comemorar</Button>
          </div>
        </form>
      )}
    </div>
  );
}
