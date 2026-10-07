import { useState, useSyncExternalStore } from "react";
import { BellRing } from "lucide-react";
import type { FollowRequestCenter } from "@/lib/notifications/follow-requests";
import { Button } from "@/components/ui/button";
import { OfficeNotice } from "./OfficeToastLayer";

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

  if (pending.length === 0 && missed.length === 0) return null;

  return (
    <>
      {pending.map((e) => (
        <OfficeNotice key={e.fromUid} kind="action">
        <div
          key={e.fromUid}
          role="alertdialog"
          aria-label={`${e.fromName} chamou você`}
          className="w-full rounded-lg border bg-card text-card-foreground shadow-lg p-4"
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
        </OfficeNotice>
      ))}

      {missed.length > 0 && (
        <OfficeNotice kind="action">
        <div className="flex flex-col items-end gap-2 w-full">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setOpen((o) => !o)}
            className="gap-1.5 bg-card text-xs shadow-sm"
            aria-expanded={open}
          >
            <BellRing className="h-3.5 w-3.5 text-primary" />
            {missed.length} {missed.length === 1 ? "chamado" : "chamados"}
          </Button>
          {open && (
            <div className="w-full rounded-lg border bg-card shadow-lg p-2 space-y-1">
              {missed.map((e) => (
                <div key={e.fromUid} className="flex flex-wrap items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-muted/60">
                  <span className="w-full text-sm break-words">{e.fromName} chamou você</span>
                  <Button size="sm" className="h-7" onClick={() => { center.resolve(e.fromUid); onFollow(e.fromUid); setOpen(false); }}>Seguir</Button>
                  <Button size="sm" variant="ghost" className="h-7" onClick={() => center.resolve(e.fromUid)}>Dispensar</Button>
                </div>
              ))}
            </div>
          )}
        </div>
        </OfficeNotice>
      )}
    </>
  );
}
