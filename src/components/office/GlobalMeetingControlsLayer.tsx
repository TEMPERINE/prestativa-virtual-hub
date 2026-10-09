import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { MeetingControlsBar, type StageControls } from "./MeetingStage";

/** Acima de qualquer camada de reunião/apresentação (o share usa 2147483600). */
export const GLOBAL_MEETING_CONTROLS_Z = 2147483646;

function useFullscreenElement(): Element | null {
  const [el, setEl] = useState<Element | null>(null);
  useEffect(() => {
    const update = () => setEl(document.fullscreenElement ?? null);
    update();
    document.addEventListener("fullscreenchange", update);
    return () => document.removeEventListener("fullscreenchange", update);
  }, []);
  return el;
}

/**
 * Camada global dos controles de mídia: só espelha o estado do Office e chama
 * os mesmos handlers. Montada por quem cobre a UI normal (palco ou share).
 * Host com pointer-events none; só a barra recebe cliques.
 */
export function GlobalMeetingControlsLayer({ controls }: { controls: StageControls }) {
  const fs = useFullscreenElement();
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      data-testid="global-meeting-controls"
      className="fixed inset-x-0 bottom-0 h-24 pointer-events-none"
      style={{ zIndex: GLOBAL_MEETING_CONTROLS_Z }}
    >
      <div className="pointer-events-auto">
        <MeetingControlsBar c={controls} />
      </div>
    </div>,
    fs ?? document.body,
  );
}
