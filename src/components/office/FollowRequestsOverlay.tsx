import { useState, useSyncExternalStore } from "react";
import { BellRing } from "lucide-react";
import type { FollowRequestCenter } from "@/lib/notifications/follow-requests";
import { Button } from "@/components/ui/button";

type Props = {
  center: FollowRequestCenter;
  onFollow: (fromUid: string) => void;
  onDecline: (fromUid: string) => void;
};

const EMPTY: never[] = [];

/** Popups persistentes de "chamar para seguir" + indicador de chamados perdidos. */
export function FollowRequestsOverlay({ center, onFollow, onDecline }: Props) {
  const entries = useSyncExternalStore(center.subscribe, center.entries, () => EMPTY);
  const [open, setOpen] = useState(false);
  const pending = entries.filter((e) => e.status === "pending");
  const missed = entries.filter((e) => e.status === "missed");

  return (
    <div className="fixed top-4 right-4 z-[150] flex flex-col items-end gap-2 w-[min(92vw,340px)]" translate="no">
      {pending.map((e) => (
        <div
          key={e.fromUid}
          role="alertdialog"
          aria-label={`${e.fromName} chamou você`}
          className="w-full rounded-xl border bg-card text-card-foreground shadow-lg p-4 animate-in fade-in slide-in-from-top-2"
        >
          <div className="flex items-start gap-3">
            <BellRing className="h-5 w-5 text-primary shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm">{e.fromName} chamou você</p>
              <p className="text-sm text-muted-foreground">Quer seguir {e.fromName} pelo escritório?</p>
              <div className="flex gap-2 mt-3">
                <Button size="sm" onClick={() => { center.resolve(e.fromUid); onFollow(e.fromUid); }}>Seguir</Button>
                <Button size="sm" variant="ghost" onClick={() => { center.resolve(e.fromUid); onDecline(e.fromUid); }}>Agora não</Button>
              </div>
            </div>
          </div>
        </div>
      ))}

      {missed.length > 0 && (
        <div className="flex flex-col items-end gap-2 w-full">
          <button
            onClick={() => setOpen((o) => !o)}
            className="flex items-center gap-1.5 rounded-full border bg-card px-3 py-1.5 text-xs font-medium shadow-sm hover:bg-muted"
            aria-expanded={open}
          >
            <BellRing className="h-3.5 w-3.5 text-primary" />
            {missed.length} {missed.length === 1 ? "chamado" : "chamados"}
          </button>
          {open && (
            <div className="w-full rounded-xl border bg-card shadow-lg p-2 space-y-1">
              {missed.map((e) => (
                <div key={e.fromUid} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-muted/60">
                  <span className="flex-1 text-sm truncate">{e.fromName} chamou você</span>
                  <Button size="sm" className="h-7" onClick={() => { center.resolve(e.fromUid); onFollow(e.fromUid); setOpen(false); }}>Seguir</Button>
                  <Button size="sm" variant="ghost" className="h-7" onClick={() => center.resolve(e.fromUid)}>Dispensar</Button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
