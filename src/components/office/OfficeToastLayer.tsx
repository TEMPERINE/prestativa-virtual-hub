import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

const TargetContext = createContext<HTMLDivElement | null>(null);
const listeners = new Set<() => void>();
let active = false;
function setActive(value: boolean) {
  active = value;
  listeners.forEach((listener) => listener());
}
export function useOfficeToastActive() {
  return useSyncExternalStore((listener) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, () => active, () => false);
}

/** Visual-only portal: notice owners retain their timers, state and actions. */
export function OfficeNotice({ children, priority = 30 }: { children: ReactNode; priority?: number }) {
  const target = useContext(TargetContext);
  if (!target) return null;
  return createPortal(
    <div className="office-notice pointer-events-auto w-full" style={{ order: priority }} onPointerDown={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
      {children}
    </div>, target,
  );
}

/** Coordinates existing custom notices and the single global Sonner viewport. */
export function OfficeToastLayer({ children, sceneRef, showTeam }: {
  children: ReactNode;
  sceneRef: RefObject<HTMLDivElement | null>;
  showTeam: boolean;
}) {
  const [target, setTarget] = useState<HTMLDivElement | null>(null);
  const layerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const scene = sceneRef.current;
    const layer = layerRef.current;
    if (!scene || !layer || !target) return;
    const header = scene.querySelector<HTMLElement>("[data-office-topbar]");
    const team = scene.querySelector<HTMLElement>("[data-office-team]");
    const root = document.documentElement;
    const update = () => {
      const bounds = scene.getBoundingClientRect();
      const teamBounds = team?.getBoundingClientRect();
      const left = Math.max(0, bounds.left);
      const right = Math.min(window.innerWidth, bounds.right, teamBounds ? teamBounds.left - 12 : Infinity);
      const available = Math.max(0, right - left);
      const width = Math.min(420, Math.max(0, available - 24));
      const center = left + available / 2;
      const top = (header?.getBoundingClientRect().bottom ?? bounds.top + 44) + 12;
      const height = target.getBoundingClientRect().height;
      layer.style.setProperty("--office-notice-center", `${center}px`);
      layer.style.setProperty("--office-notice-width", `${width}px`);
      layer.style.setProperty("--office-notice-top", `${top}px`);
      root.style.setProperty("--office-toast-center", `${center}px`);
      root.style.setProperty("--office-toast-width", `${width}px`);
      root.style.setProperty("--office-toast-top", `${top + (height > 0 ? height + 8 : 0)}px`);
    };
    update();
    setActive(true);
    const observer = new ResizeObserver(update);
    observer.observe(scene);
    observer.observe(target);
    if (header) observer.observe(header);
    if (team) observer.observe(team);
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
      setActive(false);
      ["--office-toast-center", "--office-toast-width", "--office-toast-top"].forEach((key) => root.style.removeProperty(key));
    };
  }, [sceneRef, showTeam, target]);

  return (
    <TargetContext.Provider value={target}>
      {children}
      <div ref={layerRef} data-office-toast-layer className="office-toast-layer pointer-events-none fixed z-[250]">
        <div ref={setTarget} className="flex w-full flex-col gap-2" />
      </div>
    </TargetContext.Provider>
  );
}