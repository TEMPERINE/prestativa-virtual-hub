import { useEffect } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { OfficeNotice } from "./OfficeToastLayer";
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

  return (
    <OfficeNotice priority={30}>
      <div
        role="status"
        aria-live="polite"
        onClick={onClose}
        onPointerDown={(e) => e.stopPropagation()}
        className={`relative cursor-pointer w-full rounded-lg border bg-card text-card-foreground shadow-lg px-4 py-3 ${missed ? "opacity-90" : "border-primary/40"}`}
      >
        {!missed && <ConfettiBurst facing="down" burstKey={parseInt(id.replace(/[^0-9a-f]/gi, "").slice(0, 8) || "1", 16)} />}
        <Button
          variant="ghost"
          size="icon"
          type="button"
          aria-label="Fechar comemoração"
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          className="absolute right-2 top-2 h-6 w-6 text-muted-foreground"
        >
          <X className="h-4 w-4" />
        </Button>
        <div className="flex items-start gap-3 pr-6">
          <div className={`text-3xl leading-none ${missed ? "" : "origin-top animate-[bell-wiggle_0.6s_ease-in-out_3]"}`} aria-hidden>
            {missed ? null : "🔔"}
          </div>
          <div className="min-w-0">
            {missed ? (
              <>
                <div className="text-sm font-semibold">🎉 Teve comemoração por aqui!</div>
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
    </OfficeNotice>
  );
}
