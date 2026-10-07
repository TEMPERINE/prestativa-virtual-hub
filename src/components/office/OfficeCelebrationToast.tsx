import { useEffect } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { ConfettiBurst } from "./ConfettiBurst";
import { CELEBRATION_TOAST_MS } from "@/lib/office/bell-celebration";

type Props = {
  id: string;
  senderName: string;
  message: string;
  missed: boolean;
  onClose: () => void;
};

/** Toast festivo não-bloqueante no centro superior; some sozinho em ~12 s. */
export function OfficeCelebrationToast({ id, senderName, message, missed, onClose }: Props) {
  useEffect(() => {
    const t = window.setTimeout(onClose, missed ? 8000 : CELEBRATION_TOAST_MS);
    return () => window.clearTimeout(t);
  }, [id, missed, onClose]);

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 top-4 z-[250] flex justify-center px-4">
      <div
        role="status"
        aria-live="polite"
        onClick={onClose}
        onPointerDown={(e) => e.stopPropagation()}
        className={`pointer-events-auto relative cursor-pointer max-w-md w-full rounded-2xl border bg-card text-card-foreground shadow-2xl px-4 py-3 animate-in fade-in slide-in-from-top-4 duration-300 ${missed ? "opacity-90" : "border-primary/40"}`}
      >
        {!missed && <ConfettiBurst facing="down" burstKey={parseInt(id.replace(/[^0-9a-f]/gi, "").slice(0, 8) || "1", 16)} />}
        <button
          type="button"
          aria-label="Fechar comemoração"
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          className="absolute right-2 top-2 rounded p-1 text-muted-foreground hover:bg-muted"
        >
          <X className="h-4 w-4" />
        </button>
        <div className="flex items-start gap-3 pr-6">
          <div className={`text-3xl leading-none ${missed ? "" : "origin-top animate-[bell-wiggle_0.6s_ease-in-out_3]"}`} aria-hidden>
            {missed ? "🎉" : "🔔"}
          </div>
          <div className="min-w-0">
            {missed ? (
              <>
                <div className="text-sm font-semibold">Você perdeu uma comemoração</div>
                <div className="text-sm text-muted-foreground break-words">
                  {senderName} tocou o sino: {message}
                </div>
              </>
            ) : (
              <>
                <div className="text-xs font-bold uppercase tracking-wide text-primary">
                  {senderName} tocou o sino!
                </div>
                <div className="text-base font-medium break-words">{message}</div>
              </>
            )}
          </div>
        </div>
        <style>{`@keyframes bell-wiggle{0%,100%{transform:rotate(0)}25%{transform:rotate(-18deg)}75%{transform:rotate(18deg)}}`}</style>
      </div>
    </div>,
    document.body,
  );
}
