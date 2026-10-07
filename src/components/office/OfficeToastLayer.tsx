import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { toast, useSonner } from "sonner";
import { Button } from "@/components/ui/button";
import { X, CheckCircle2, AlertCircle } from "lucide-react";
import { selectOfficeNotices, type OfficeNoticeEntry, type OfficeNoticeKind } from "@/lib/office/notice-priority";

const VisibilityContext = createContext(true);
const QueueContext = createContext<{ register: (id: string, kind: OfficeNoticeKind) => () => void; visible: string[] } | null>(null);

const TargetContext = createContext<HTMLDivElement | null | undefined>(undefined);
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

/** Visual-only registration; action owners keep their original lifecycle. */
export function OfficeNotice({ children, kind = "celebration" }: { children: ReactNode; kind?: OfficeNoticeKind }) {
  const id = useId();
  const target = useContext(TargetContext);
  const queue = useContext(QueueContext);
  const register = queue?.register;
  useLayoutEffect(() => register?.(id, kind), [register, id, kind]);
  const visible = !queue || queue.visible.includes(id);
  if (target === undefined) return <>{children}</>;
  if (!target) return null;
  const order = queue?.visible.indexOf(id) ?? 0;
  return createPortal(
    <VisibilityContext.Provider value={visible}>
      <div hidden={!visible} data-office-notice-kind={kind} className="office-notice pointer-events-auto w-full" style={{ order }} onPointerDown={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
        {children}
      </div>
    </VisibilityContext.Provider>, target,
  );
}

type SonnerEntry = ReturnType<typeof useSonner>["toasts"][number];
function SonnerNoticeContent({ entry }: { entry: SonnerEntry }) {
  const visible = useContext(VisibilityContext);
  const [paused, setPaused] = useState(false);
  const remaining = useRef(entry.duration ?? 4000);
  useEffect(() => { remaining.current = entry.duration ?? 4000; }, [entry]);
  useEffect(() => {
    if (!visible || paused || remaining.current === Infinity || entry.type === "loading") return;
    const start = Date.now();
    const timer = window.setTimeout(() => {
      entry.onAutoClose?.(entry);
      toast.dismiss(entry.id);
    }, remaining.current);
    return () => { window.clearTimeout(timer); remaining.current = Math.max(0, remaining.current - (Date.now() - start)); };
  }, [entry, visible, paused]);
  const dismiss = () => { entry.onDismiss?.(entry); toast.dismiss(entry.id); };
  const renderAction = (action: SonnerEntry["action"], cancel = false) => {
    if (action && typeof action === "object" && "label" in action && "onClick" in action) {
      return <Button size="sm" variant={cancel ? "ghost" : "default"} onClick={(event) => {
        action.onClick(event);
        if (!event.defaultPrevented) toast.dismiss(entry.id);
      }}>{action.label}</Button>;
    }
    return action;
  };
  const title = typeof entry.title === "function" ? entry.title() : entry.title;
  const description = typeof entry.description === "function" ? entry.description() : entry.description;
  return <div role={entry.type === "error" ? "alert" : "status"} className="relative w-full rounded-lg border bg-card p-4 text-card-foreground shadow-lg" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocusCapture={() => setPaused(true)} onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setPaused(false); }}>
    {entry.jsx ?? <>
      <div className="flex items-start gap-2">
        {entry.icon ?? (entry.type === "error" ? <AlertCircle className="h-4 w-4 shrink-0 text-destructive" /> : entry.type === "success" ? <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" /> : null)}
        <div className="min-w-0 flex-1 break-words pr-4"><p className="text-sm font-semibold">{title}</p>{description && <div className="mt-1 text-xs text-muted-foreground">{description}</div>}</div>
      </div>
      {(entry.action || entry.cancel) && <div className="mt-3 flex flex-wrap gap-2">{renderAction(entry.action)}{renderAction(entry.cancel, true)}</div>}
    </>}
    {entry.closeButton && entry.dismissible !== false && <Button variant="ghost" size="icon" className="absolute right-1 top-1 h-6 w-6" aria-label="Fechar aviso" onClick={dismiss}><X className="h-4 w-4" /></Button>}
  </div>;
}

function OfficeSonnerNotices() {
  const { toasts } = useSonner();
  return <>{toasts.filter((entry) => !entry.delete).slice().reverse().map((entry) =>
    <OfficeNotice key={entry.id} kind={entry.action || entry.cancel ? "action" : "informational"}>
      <SonnerNoticeContent entry={entry} />
    </OfficeNotice>,
  )}</>;
}

export function OfficeAreaNotice({ zoneId, label }: { zoneId?: string; label?: string }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    setShown(Boolean(zoneId));
    const timer = window.setTimeout(() => setShown(false), 1800);
    return () => window.clearTimeout(timer);
  }, [zoneId]);
  if (!shown || !label) return null;
  return <OfficeNotice kind="informational"><div role="status" className="w-full rounded-lg border bg-card px-3 py-2 text-xs text-muted-foreground shadow-sm">Você entrou em <span className="font-medium text-foreground">{label}</span></div></OfficeNotice>;
}

/** Coordinates existing custom notices and the single global Sonner viewport. */
export function OfficeToastLayer({ children, sceneRef, showTeam }: {
  children: ReactNode;
  sceneRef: RefObject<HTMLDivElement | null>;
  showTeam: boolean;
}) {
  const [target, setTarget] = useState<HTMLDivElement | null>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const [entries, setEntries] = useState<OfficeNoticeEntry[]>([]);
  const sequence = useRef(0);
  const register = useCallback((id: string, kind: OfficeNoticeKind) => {
    const entry = { id, kind, sequence: sequence.current++ };
    setEntries((previous) => [...previous.filter((item) => item.id !== id), entry]);
    return () => setEntries((previous) => previous.filter((item) => item.id !== id));
  }, []);
  const queue = useMemo(() => ({ register, visible: selectOfficeNotices(entries) }), [register, entries]);

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
      root.style.setProperty("--office-celebration-left", `${left}px`);
      root.style.setProperty("--office-celebration-top", `${top}px`);
      root.style.setProperty("--office-celebration-width", `${available}px`);
      root.style.setProperty("--office-celebration-height", `${Math.max(0, Math.min(window.innerHeight, bounds.bottom) - top)}px`);
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
      ["--office-toast-center", "--office-toast-width", "--office-toast-top", "--office-celebration-left", "--office-celebration-top", "--office-celebration-width", "--office-celebration-height"].forEach((key) => root.style.removeProperty(key));
    };
  }, [sceneRef, showTeam, target]);

  return (
    <QueueContext.Provider value={queue}>
    <TargetContext.Provider value={target}>
      {children}
      <OfficeSonnerNotices />
      <div ref={layerRef} data-office-toast-layer className="office-toast-layer pointer-events-none fixed z-[350]">
        <div ref={setTarget} className="flex w-full flex-col gap-2" />
      </div>
    </TargetContext.Provider>
    </QueueContext.Provider>
  );
}