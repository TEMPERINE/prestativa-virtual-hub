/**
 * RTC v2 — Fase 3: Privacy Guard.
 *
 * Suspensão LOCAL de mic/câmera quando a aba fica oculta por ≥ 30s.
 * Não toca em Room, MediaContext, presença, movimento, Egress ou reunião:
 * só chama setMicrophoneEnabled/setCameraEnabled(false) do lifecycle da Fase 2.
 * Estado separado: `saved` (o que estava ON antes) ≠ intent atual ≠ suspensão.
 */
import { emitTelemetry, type RtcTelemetrySink } from "./rtc-telemetry-types";

export const PRIVACY_GUARD_DELAY_MS = 30_000;

export interface PrivacyGuardMedia {
  isMicOn(): boolean;
  isCamOn(): boolean;
  isScreenSharing(): boolean;
  setMic(on: boolean): Promise<void>;
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
  saved: { mic: boolean; cam: boolean } | null;
}

const defaultTimers: PrivacyGuardTimers = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (h) => globalThis.clearTimeout(h as ReturnType<typeof setTimeout>),
};

export class PrivacyGuard {
  private hidden = false;
  private timer: unknown = null;
  /** 30s expiraram com screen share ativo → suspender quando o share acabar. */
  private waitingShareEnd = false;
  private saved: { mic: boolean; cam: boolean } | null = null;
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
      if (this.timer !== null || this.waitingShareEnd) {
        this.clearTimer();
        this.waitingShareEnd = false;
        emitTelemetry(this.telemetry, "PRIVACY_GUARD_CANCELLED");
      }
    }
    this.emit();
  }

  /** Chamado a cada mudança da mídia local (detecta fim de screen share). */
  onLocalMediaChange(): void {
    if (this.disposed) return;
    if (this.waitingShareEnd && this.hidden && !this.media.isScreenSharing()) {
      this.waitingShareEnd = false;
      void this.suspend();
    }
  }

  /** Reativar: liga só o que estava ON antes da suspensão. */
  async restore(): Promise<void> {
    const s = this.saved;
    if (!s || this.disposed) return;
    this.saved = null;
    this.emit();
    emitTelemetry(this.telemetry, "PRIVACY_GUARD_RESTORED", { metadata: { mic: s.mic, cam: s.cam } });
    const ops: Promise<void>[] = [];
    if (s.mic && !this.media.isMicOn()) ops.push(this.media.setMic(true));
    if (s.cam && !this.media.isCamOn()) ops.push(this.media.setCam(true));
    await Promise.allSettled(ops);
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
    this.waitingShareEnd = false;
    this.saved = null;
    this.disposed = true;
    this.listeners.clear();
  }

  // ─── internos ─────────────────────────────────────────
  private onTimeout(): void {
    this.timer = null;
    if (this.disposed || !this.hidden) return;
    if (this.media.isScreenSharing()) {
      this.waitingShareEnd = true;
      emitTelemetry(this.telemetry, "PRIVACY_GUARD_SKIPPED_SCREEN_SHARE");
      return;
    }
    void this.suspend();
  }

  private async suspend(): Promise<void> {
    const mic = this.media.isMicOn();
    const cam = this.media.isCamOn();
    if (!mic && !cam) return; // nada a fazer, sem aviso
    this.saved = { mic, cam };
    emitTelemetry(this.telemetry, "PRIVACY_GUARD_SUSPENDED", { metadata: { mic, cam } });
    this.emit();
    const ops: Promise<void>[] = [];
    if (mic) ops.push(this.media.setMic(false));
    if (cam) ops.push(this.media.setCam(false));
    await Promise.allSettled(ops);
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
