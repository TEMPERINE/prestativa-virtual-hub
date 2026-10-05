import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

/** Aviso de reunião inativa. Contador vem do deadline absoluto compartilhado. */
export function MeetingIdleWarning({
  deadlineAt,
  onContinue,
}: {
  deadlineAt: number;
  onContinue: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const h = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(h);
  }, []);
  const secs = Math.max(0, Math.ceil((deadlineAt - now) / 1000));
  const mm = String(Math.floor(secs / 60)).padStart(2, "0");
  const ss = String(secs % 60).padStart(2, "0");
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="meeting-idle-title"
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-background/60 backdrop-blur-sm"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="w-[min(92vw,380px)] rounded-xl border bg-card p-6 text-card-foreground shadow-xl">
        <h2 id="meeting-idle-title" className="text-lg font-semibold">
          Alguém ainda está na reunião?
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Não detectamos atividade nos últimos 5 minutos. A reunião será encerrada em:
        </p>
        <div className="my-4 text-center font-mono text-4xl font-bold tabular-nums">
          {mm}:{ss}
        </div>
        <Button className="w-full" autoFocus onClick={onContinue}>
          Continuar reunião
        </Button>
      </div>
    </div>
  );
}
