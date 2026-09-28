/**
 * RTC v2 — Etapa 3B: integração da sessão única com o mount/unmount do workspace.
 *
 * - Idempotente sob React StrictMode: setup → cleanup → setup reaproveita o
 *   mesmo controlador (sem segunda claim, sem segundo canal, sem auto-takeover).
 *   O release real só acontece se nenhum setup ocorrer até o próximo tick.
 * - Watchdog de ownership: a cada 30 s, ao voltar a aba visível e ao voltar
 *   online. É fallback; o broadcast SESSION_REPLACED continua o caminho rápido.
 * - REPLACED é terminal para o binding: nunca recupera controle sozinho.
 */
import {
  OfficeSessionController,
  type OfficeSessionBackend,
  type OfficeSessionState,
  type OfficeSessionStatus,
} from "./office-session";

export const REVALIDATE_INTERVAL_MS = 30_000;

export type OfficeGateView = "loading" | "scene" | "replaced" | "error";

/** Decisão única do que a rota pode montar. Só ACTIVE monta o OfficeScene. */
export function officeGateView(status: OfficeSessionStatus): OfficeGateView {
  switch (status) {
    case "ACTIVE":
      return "scene";
    case "REPLACED":
      return "replaced";
    case "ERROR":
      return "error";
    default:
      return "loading";
  }
}

export interface BindingEnv {
  setInterval: (fn: () => void, ms: number) => unknown;
  clearInterval: (id: unknown) => void;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (id: unknown) => void;
  addWindowListener: (type: "online", fn: () => void) => () => void;
  addDocumentListener: (type: "visibilitychange", fn: () => void) => () => void;
  isVisible: () => boolean;
}

export function browserBindingEnv(): BindingEnv {
  return {
    setInterval: (fn, ms) => window.setInterval(fn, ms),
    clearInterval: (id) => window.clearInterval(id as number),
    setTimeout: (fn, ms) => window.setTimeout(fn, ms),
    clearTimeout: (id) => window.clearTimeout(id as number),
    addWindowListener: (type, fn) => {
      window.addEventListener(type, fn);
      return () => window.removeEventListener(type, fn);
    },
    addDocumentListener: (type, fn) => {
      document.addEventListener(type, fn);
      return () => document.removeEventListener(type, fn);
    },
    isVisible: () => document.visibilityState === "visible",
  };
}

interface Entry {
  controller: OfficeSessionController;
  refs: number;
  pendingRelease: unknown | null;
  stopWatchdog: (() => void) | null;
}

export interface OfficeSessionBindingHandle {
  controller: OfficeSessionController;
  getState: () => OfficeSessionState;
  subscribe: (fn: (s: OfficeSessionState) => void) => () => void;
  retry: () => Promise<void>;
  release: () => void;
}

export class OfficeSessionBinder {
  private entries = new Map<string, Entry>();

  constructor(
    private readonly makeBackend: () => OfficeSessionBackend,
    private readonly env: BindingEnv,
    private readonly newSessionId?: () => string,
  ) {}

  /** Número de controladores vivos (para testes/diagnóstico). */
  size(): number {
    return this.entries.size;
  }

  acquire(userId: string, workspaceId: string): OfficeSessionBindingHandle {
    const key = `${userId}|${workspaceId}`;
    let entry = this.entries.get(key);
    if (entry) {
      if (entry.pendingRelease !== null) {
        this.env.clearTimeout(entry.pendingRelease);
        entry.pendingRelease = null;
      }
    } else {
      const controller = new OfficeSessionController(this.makeBackend(), this.newSessionId);
      entry = { controller, refs: 0, pendingRelease: null, stopWatchdog: null };
      this.entries.set(key, entry);
      entry.stopWatchdog = this.startWatchdog(controller);
      void controller.claim(userId, workspaceId);
    }
    entry.refs++;
    const e = entry;
    let released = false;
    return {
      controller: e.controller,
      getState: () => e.controller.getState(),
      subscribe: (fn) => e.controller.subscribe(fn),
      retry: async () => {
        // Retry só é permitido a partir de ERROR. REPLACED nunca retoma sozinho.
        if (e.controller.getState().status !== "ERROR") return;
        await e.controller.claim(userId, workspaceId);
      },
      release: () => {
        if (released) return;
        released = true;
        e.refs--;
        if (e.refs > 0) return;
        e.pendingRelease = this.env.setTimeout(() => {
          e.pendingRelease = null;
          if (e.refs > 0) return;
          this.entries.delete(key);
          e.stopWatchdog?.();
          void e.controller.release();
        }, 0);
      },
    };
  }

  private startWatchdog(controller: OfficeSessionController): () => void {
    const check = () => {
      if (controller.getState().status === "ACTIVE") void controller.revalidate();
    };
    const interval = this.env.setInterval(check, REVALIDATE_INTERVAL_MS);
    const offVis = this.env.addDocumentListener("visibilitychange", () => {
      if (this.env.isVisible()) check();
    });
    const offOnline = this.env.addWindowListener("online", check);
    return () => {
      this.env.clearInterval(interval);
      offVis();
      offOnline();
    };
  }
}
