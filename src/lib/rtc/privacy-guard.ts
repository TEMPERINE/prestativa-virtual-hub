/**
 * RTC v2 — Fase 3: Privacy Guard.
 *
 * Suspensão LOCAL somente da CÂMERA quando a aba fica oculta por ≥ 30s.
 * O microfone NUNCA é tocado (segue só a intenção do usuário) e screen share
 * não bloqueia nem é afetado. Não toca em Room, MediaContext, presença,
 * movimento, Egress ou reunião: só chama setCam(false) do lifecycle atual.
 * Estado separado: `saved` (o que estava ON antes) ≠ intent atual ≠ suspensão.
 */
import { emitTelemetry, type RtcTelemetrySink } from "./rtc-telemetry-types";

export const PRIVACY_GUARD_DELAY_MS = 30_000;

export interface PrivacyGuardMedia {
  isCamOn(): boolean;
  setCam(on: boolean): Promise<void>;
}

export interface PrivacyGuardTimers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(h: unknown): void;
}

export interface PrivacyGuardSnapshot {
  /** Suspensão real ocorreu e aguarda escolha do usuário. */
  suspended: boolean;
  /** Mostrar aviso (suspenso + página visível). */
  promptVisible: boolean;
  saved: { cam: boolean } | null;
}

const defaultTimers: PrivacyGuardTimers = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (h) => globalThis.clearTimeout(h as ReturnType<typeof setTimeout>),
};

export class PrivacyGuard {
  private hidden = false;
  private timer: unknown = null;
  private saved: { cam: boolean } | null = null;
  private disposed = false;
  private snap: PrivacyGuardSnapshot = { suspended: false, promptVisible: false, saved: null };
  private listeners = new Set<() => void>();
  private readonly timers: PrivacyGuardTimers;
  private readonly delay: number;

  constructor(
    private readonly media: PrivacyGuardMedia,
    opts: { telemetry?: RtcTelemetrySink; timers?: PrivacyGuardTimers; delayMs?: number } = {},
  ) {
    this.telemetry = opts.telemetry;
    this.timers = opts.timers ?? defaultTimers;
    this.delay = opts.delayMs ?? PRIVACY_GUARD_DELAY_MS;
  }
  private readonly telemetry?: RtcTelemetrySink;

  setVisibility(hidden: boolean): void {
    if (this.disposed || hidden === this.hidden) return;
    this.hidden = hidden;
    if (hidden) {
      if (this.saved) return; // já suspenso
      this.clearTimer();
      this.timer = this.timers.setTimeout(() => this.onTimeout(), this.delay);
      emitTelemetry(this.telemetry, "PRIVACY_GUARD_ARMED");
    } else {
      if (this.timer !== null) {
        this.clearTimer();
        emitTelemetry(this.telemetry, "PRIVACY_GUARD_CANCELLED");
      }
    }
    this.emit();
  }

  /** Mantido por compatibilidade; screen share não influencia mais o guard. */
  onLocalMediaChange(): void {}

  /** Reativar câmera: religa somente a câmera (nunca o mic). */
  async restore(): Promise<void> {
    const s = this.saved;
    if (!s || this.disposed) return;
    this.saved = null;
    this.emit();
    emitTelemetry(this.telemetry, "PRIVACY_GUARD_RESTORED", { metadata: { cam: s.cam } });
    if (s.cam && !this.media.isCamOn()) await this.media.setCam(true).catch(() => {});
  }

  keepOff(): void {
    if (!this.saved || this.disposed) return;
    this.saved = null;
    emitTelemetry(this.telemetry, "PRIVACY_GUARD_KEEP_OFF");
    this.emit();
  }

  /** Escolha manual do usuário após o retorno vira a nova intenção. */
  noteManualToggle(): void {
    if (this.saved && !this.hidden) {
      this.saved = null;
      this.emit();
    }
  }

  getSnapshot = (): PrivacyGuardSnapshot => this.snap;
  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  dispose(): void {
    if (this.disposed) return;
    this.clearTimer();
    this.saved = null;
    this.disposed = true;
    this.listeners.clear();
  }

  // ─── internos ─────────────────────────────────────────
  private onTimeout(): void {
    this.timer = null;
    if (this.disposed || !this.hidden) return;
    void this.suspend();
  }

  private async suspend(): Promise<void> {
    if (!this.media.isCamOn()) return; // câmera já OFF: nenhuma operação, sem aviso
    this.saved = { cam: true };
    emitTelemetry(this.telemetry, "PRIVACY_GUARD_SUSPENDED", { metadata: { cam: true } });
    this.emit();
    await this.media.setCam(false).catch(() => {});
  }

  private clearTimer(): void {
    if (this.timer !== null) this.timers.clearTimeout(this.timer);
    this.timer = null;
  }

  private emit(): void {
    if (this.disposed) return;
    const suspended = this.saved !== null;
    this.snap = { suspended, promptVisible: suspended && !this.hidden, saved: this.saved };
    for (const l of this.listeners) l();
  }
}
