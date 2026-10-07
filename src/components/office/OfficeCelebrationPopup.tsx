import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BellRing, PartyPopper, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AlignedSprite } from "@/components/sprites/AlignedSprite";
import { CELEBRATION_TOAST_MS } from "@/lib/office/bell-celebration";

type Props = {
  id: string;
  senderName: string;
  spriteId?: string | null;
  message: string;
  onClose: () => void;
};

/** Independent visual celebration; never owns Office focus, movement or media. */
export function OfficeCelebrationPopup({ id, senderName, spriteId, message, onClose }: Props) {
  const [visible, setVisible] = useState(false);
  const remaining = useRef(CELEBRATION_TOAST_MS);
  useEffect(() => {
    remaining.current = CELEBRATION_TOAST_MS;
    const update = () => setVisible(document.visibilityState === "visible" && document.hasFocus());
    update();
    document.addEventListener("visibilitychange", update);
    window.addEventListener("focus", update);
    window.addEventListener("blur", update);
    return () => {
      document.removeEventListener("visibilitychange", update);
      window.removeEventListener("focus", update);
      window.removeEventListener("blur", update);
    };
  }, [id]);
  useEffect(() => {
    if (!visible) return;
    let start: number | undefined;
    let timer: number | undefined;
    const frame = window.requestAnimationFrame(() => {
      start = Date.now();
      timer = window.setTimeout(onClose, remaining.current);
    });
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
      if (start !== undefined) remaining.current = Math.max(0, remaining.current - (Date.now() - start));
    };
  }, [id, visible, onClose]);

  if (!visible) return null;
  return createPortal(
    <div className="office-celebration-stage pointer-events-none fixed z-[340]" data-office-celebration>
      <div className="office-celebration-backdrop absolute inset-0" aria-hidden="true" />
      <section
        role="dialog"
        aria-modal="false"
        aria-labelledby={`celebration-title-${id}`}
        aria-describedby={`celebration-message-${id}`}
        className="office-celebration-popup pointer-events-auto relative cursor-pointer rounded-lg text-card-foreground"
        onClick={onClose}
        onPointerDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => { event.stopPropagation(); if (event.key === "Escape") onClose(); }}
      >
        <div className="office-celebration-ribbon" aria-hidden="true" />
        <Button variant="ghost" size="icon" type="button" aria-label="Fechar comemoração" title="Fechar comemoração"
          onClick={(event) => { event.stopPropagation(); onClose(); }}
          className="absolute right-3 top-3 z-10 h-8 w-8 text-muted-foreground">
          <X className="h-4 w-4" />
        </Button>
        <div className="office-celebration-confetti absolute inset-0 overflow-hidden rounded-lg" aria-hidden="true">
          {Array.from({ length: 22 }, (_, i) => <span key={i} style={{ "--piece": i, "--lane": `${(i * 37 + 7) % 100}%`, "--turn": `${i * 47}deg` } as React.CSSProperties} />)}
        </div>
        <div className="relative flex flex-col items-center px-6 pb-10 pt-8 text-center sm:px-10">
          <p id={`celebration-title-${id}`} className="max-w-full break-words px-5 text-sm font-semibold text-muted-foreground">🎉 {senderName} tocou o sino</p>
          <div className="office-celebration-character relative my-4 flex h-36 w-44 items-center justify-center" aria-label={`Personagem de ${senderName}`}>
            <AlignedSprite spriteId={spriteId} facing="down" frame={0} size={136} />
            <span className="office-celebration-bell absolute bottom-3 right-3 flex h-12 w-12 items-center justify-center rounded-full"><BellRing className="h-6 w-6" aria-hidden="true" /></span>
            <PartyPopper className="office-celebration-party absolute left-1 top-7 h-7 w-7" aria-hidden="true" />
          </div>
          <p className="text-lg font-semibold text-primary">Vamos comemorar!</p>
          <h2 id={`celebration-message-${id}`} className="office-celebration-message mt-4 max-w-full text-2xl font-bold leading-tight sm:text-3xl">{message}</h2>
          <div className="office-celebration-footer mt-7 flex items-center gap-2" aria-hidden="true"><span /><PartyPopper className="h-4 w-4" /><span /></div>
        </div>
      </section>
    </div>, document.body,
  );
}