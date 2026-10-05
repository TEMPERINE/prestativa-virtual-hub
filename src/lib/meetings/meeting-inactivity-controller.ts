/**
 * Meeting Inactivity Guard — controlador PURO (sem React, sem Supabase, sem LiveKit).
 *
 * Detecta reuniões privadas esquecidas abertas. Camada isolada: nunca toca
 * Room/mídia/contexto. Só decide WARNING/CANCEL/EJECT e delega efeitos via deps.
 *
 * Regras-chave:
 *  - Elegível só com PRIVATE_ROOM conectada e >= 2 humanos.
 *  - Timestamps absolutos (lastActivityAt, deadlineAt); timers só disparam
 *    tick(), que sempre compara com now() — abas em background podem atrasar
 *    timers, nunca adiar o deadline.
 *  - Coordenador = menor identity (ordem lexicográfica) do roster. Só ele emite
 *    WARNING/CANCEL oficial/EJECT. Outros pedem cancelamento (request=true).
 *  - Mudança de roster = atividade + cancela warning + reinicia 5 min.
 */

export type MeetingIdleMode = "off" | "warn" | "enforce";
export type MeetingIdleState = "DISABLED" | "ACTIVE" | "WARNING" | "EJECTING";
export type MeetingIdleCancelReason =
  | "voice"
  | "movement"
  | "screen_share"
  | "continue_button"
  | "participant_change"
  | "warn_expired";

export const IDLE_TIMEOUT_MS = 5 * 60_000;
export const WARNING_DURATION_MS = 30_000;
/** Fala só conta se speaking permanecer ativo por >= 700 ms. */
export const SPEAKING_THRESHOLD_MS = 700;
/** Fala contínua renova lastActivityAt no máximo a cada 5 s (sem broadcast). */
export const SPEAKING_REFRESH_MS = 5_000;
/** Não-coordenador fecha o modal sozinho se o coordenador sumir. */
export const FOLLOWER_STALE_MS = 10_000;

export type MeetingIdleEvent =
  | {
      type: "MEETING_IDLE_WARNING";
      warningId: string;
      zoneId: string;
      issuedAt: number;
      deadlineAt: number;
      coordinatorId: string;
    }
  | {
      type: "MEETING_IDLE_CANCEL";
      warningId: string;
      zoneId: string;
      from: string;
      reason: MeetingIdleCancelReason;
      /** true = pedido de um não-coordenador; o coordenador reemite oficial. */
      request?: boolean;
    }
  | { type: "MEETING_IDLE_EJECT"; warningId: string; zoneId: string; coordinatorId: string };

export type MeetingIdleTelemetry =
  | "MEETING_IDLE_WARNING_STARTED"
  | "MEETING_IDLE_WARNING_CANCELLED"
  | "MEETING_IDLE_WOULD_EJECT"
  | "MEETING_IDLE_EJECTED"
  | "MEETING_IDLE_COORDINATOR_CHANGED";

export interface MeetingIdleContext {
  /** PRIVATE_ROOM realmente CONNECTED. */
  privateConnected: boolean;
  zoneId: string | null;
  /** Identities humanas na Room, incluindo eu. */
  participants: readonly string[];
  screenShareActive: boolean;
}

export interface MeetingIdleSnapshot {
  state: MeetingIdleState;
  zoneId: string | null;
  coordinatorId: string | null;
  warningId: string | null;
  deadlineAt: number | null;
  lastActivityAt: number;
}

export interface MeetingIdleDeps {
  mode: MeetingIdleMode;
  selfId: string;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
  send(evt: MeetingIdleEvent): void;
  /** Executa o fluxo de saída local (só o meu avatar). */
  onEject(zoneId: string): void;
  onWarning?(deadlineAt: number): void;
  onChange?(s: MeetingIdleSnapshot): void;
  telemetry?(type: MeetingIdleTelemetry, meta: Record<string, unknown>): void;
  newId?: () => string;
}

export function electCoordinator(participants: readonly string[]): string | null {
  if (participants.length === 0) return null;
  return [...participants].sort()[0];
}

export function parseMeetingIdleMode(v: unknown): MeetingIdleMode {
  return v === "warn" || v === "enforce" ? v : "off";
}

export class MeetingInactivityController {
  private state: MeetingIdleState = "DISABLED";
  private zoneId: string | null = null;
  private rosterKey = "";
  private participants = new Set<string>();
  private coordinatorId: string | null = null;
  private screenShare = false;
  private lastActivityAt: number;
  private warningId: string | null = null;
  private deadlineAt: number | null = null;
  private speakingSince = new Map<string, number>();
  private lastVoiceRefresh = 0;
  private timer: unknown = null;
  private disposed = false;

  constructor(private readonly deps: MeetingIdleDeps) {
    this.lastActivityAt = this.now();
  }

  private now() {
    return (this.deps.now ?? Date.now)();
  }

  getSnapshot(): MeetingIdleSnapshot {
    return {
      state: this.state,
      zoneId: this.zoneId,
      coordinatorId: this.coordinatorId,
      warningId: this.warningId,
      deadlineAt: this.deadlineAt,
      lastActivityAt: this.lastActivityAt,
    };
  }

  isCoordinator(): boolean {
    return this.coordinatorId === this.deps.selfId;
  }

  /** Atualiza elegibilidade/roster/screen share. Idempotente. */
  update(ctx: MeetingIdleContext): void {
    if (this.disposed) return;
    const eligible =
      this.deps.mode !== "off" &&
      ctx.privateConnected &&
      !!ctx.zoneId &&
      ctx.participants.length >= 2 &&
      ctx.participants.includes(this.deps.selfId);
    if (!eligible) {
      if (this.state !== "DISABLED") this.disable();
      return;
    }
    const now = this.now();
    const key = [...ctx.participants].sort().join("|");
    if (this.state === "DISABLED" || this.zoneId !== ctx.zoneId) {
      this.reset(ctx.zoneId!, key, ctx.participants, now);
      this.screenShare = ctx.screenShareActive;
      this.emit();
      this.schedule();
      return;
    }
    if (this.state === "EJECTING") return;
    if (key !== this.rosterKey) {
      const prevCoord = this.coordinatorId;
      const hadWarning = this.state === "WARNING";
      const prevWarning = this.warningId;
      this.rosterKey = key;
      this.participants = new Set(ctx.participants);
      for (const id of [...this.speakingSince.keys()])
        if (!this.participants.has(id)) this.speakingSince.delete(id);
      this.coordinatorId = electCoordinator(ctx.participants);
      if (prevCoord !== this.coordinatorId)
        this.tel("MEETING_IDLE_COORDINATOR_CHANGED", { coordinatorId: this.coordinatorId });
      this.lastActivityAt = now;
      if (hadWarning) {
        this.closeWarning();
        if (this.isCoordinator() && prevWarning) {
          this.deps.send({
            type: "MEETING_IDLE_CANCEL",
            warningId: prevWarning,
            zoneId: this.zoneId!,
            from: this.deps.selfId,
            reason: "participant_change",
          });
        }
        this.tel("MEETING_IDLE_WARNING_CANCELLED", { reason: "participant_change" });
      }
    }
    if (ctx.screenShareActive !== this.screenShare) {
      this.screenShare = ctx.screenShareActive;
      if (ctx.screenShareActive) this.activity("screen_share");
      else this.lastActivityAt = now; // fim do share → nova janela
    }
    this.emit();
    this.schedule();
  }

  /** speaking (LiveKit) de alguém da Room — inclusive eu. */
  speaking(userId: string, isSpeaking: boolean): void {
    if (this.state === "DISABLED" || this.state === "EJECTING") return;
    if (!this.participants.has(userId)) return;
    if (!isSpeaking) {
      this.checkSpeaking();
      this.speakingSince.delete(userId);
      return;
    }
    if (!this.speakingSince.has(userId)) this.speakingSince.set(userId, this.now());
    this.checkSpeaking();
    this.schedule();
  }

  /** MOTION_START/CHANGE/POSITION_SYNC de alguém da Room (ou meu movimento). */
  movement(userId: string): void {
    if (this.state === "DISABLED" || this.state === "EJECTING") return;
    if (!this.participants.has(userId)) return;
    this.activity("movement");
  }

  continueClicked(): void {
    if (this.state === "DISABLED" || this.state === "EJECTING") return;
    this.activity("continue_button");
  }

  receive(evt: MeetingIdleEvent): void {
    if (this.disposed || this.state === "DISABLED" || evt.zoneId !== this.zoneId) return;
    if (evt.type === "MEETING_IDLE_WARNING") {
      if (evt.coordinatorId !== this.coordinatorId || this.isCoordinator()) return;
      if (this.state === "EJECTING") return;
      if (this.state === "WARNING" && this.warningId === evt.warningId) return;
      this.state = "WARNING";
      this.warningId = evt.warningId;
      this.deadlineAt = evt.deadlineAt;
      this.deps.onWarning?.(evt.deadlineAt);
      this.emit();
      this.schedule();
      return;
    }
    if (evt.type === "MEETING_IDLE_CANCEL") {
      if (evt.warningId !== this.warningId) return;
      if (evt.request) {
        // Pedido de outro participante: o coordenador reemite oficialmente.
        if (this.isCoordinator() && this.state === "WARNING") this.cancelWarning(evt.reason);
        return;
      }
      if (evt.from !== this.coordinatorId) return;
      if (this.state === "WARNING") {
        this.closeWarning();
        this.lastActivityAt = this.now();
        this.emit();
        this.schedule();
      }
      return;
    }
    if (evt.type === "MEETING_IDLE_EJECT") {
      if (this.deps.mode !== "enforce") return;
      if (evt.coordinatorId !== this.coordinatorId || this.isCoordinator()) return;
      if (evt.warningId !== this.warningId) return;
      this.doEject();
    }
  }

  /** Reavalia tudo contra now(). Seguro chamar a qualquer momento. */
  tick(): void {
    if (this.disposed || this.state === "DISABLED" || this.state === "EJECTING") return;
    const now = this.now();
    this.checkSpeaking();
    if (this.screenShare) this.lastActivityAt = now;
    if (this.state === "ACTIVE") {
      if (this.isCoordinator() && now - this.lastActivityAt >= IDLE_TIMEOUT_MS) {
        this.startWarning(now);
      }
    } else if (this.state === "WARNING" && this.deadlineAt !== null) {
      if (this.isCoordinator() && now >= this.deadlineAt) {
        this.expire();
      } else if (!this.isCoordinator() && now >= this.deadlineAt + FOLLOWER_STALE_MS) {
        // Coordenador não confirmou: fecha localmente e reinicia (nunca ejeta sozinho).
        this.closeWarning();
        this.lastActivityAt = now;
        this.emit();
      }
    }
    this.schedule();
  }

  dispose(): void {
    this.disposed = true;
    this.clear();
  }

  // ---------- internos ----------

  private reset(zoneId: string, key: string, participants: readonly string[], now: number) {
    this.state = "ACTIVE";
    this.zoneId = zoneId;
    this.rosterKey = key;
    this.participants = new Set(participants);
    this.coordinatorId = electCoordinator(participants);
    this.lastActivityAt = now;
    this.warningId = null;
    this.deadlineAt = null;
    this.speakingSince.clear();
  }

  private disable() {
    this.state = "DISABLED";
    this.zoneId = null;
    this.rosterKey = "";
    this.participants.clear();
    this.coordinatorId = null;
    this.warningId = null;
    this.deadlineAt = null;
    this.screenShare = false;
    this.speakingSince.clear();
    this.clear();
    this.emit();
  }

  private checkSpeaking() {
    const now = this.now();
    for (const since of this.speakingSince.values()) {
      if (now - since >= SPEAKING_THRESHOLD_MS) {
        if (this.state === "WARNING") this.activity("voice");
        else if (now - this.lastVoiceRefresh >= SPEAKING_REFRESH_MS || this.lastVoiceRefresh === 0) {
          this.lastVoiceRefresh = now;
          this.lastActivityAt = now;
        }
        return;
      }
    }
  }

  private activity(reason: MeetingIdleCancelReason) {
    const now = this.now();
    this.lastActivityAt = now;
    if (reason === "voice") this.lastVoiceRefresh = now;
    if (this.state === "WARNING") {
      if (this.isCoordinator()) this.cancelWarning(reason);
      else {
        if (this.warningId)
          this.deps.send({
            type: "MEETING_IDLE_CANCEL",
            warningId: this.warningId,
            zoneId: this.zoneId!,
            from: this.deps.selfId,
            reason,
            request: true,
          });
        // Fecha localmente já; o oficial do coordenador é idempotente.
        this.closeWarning();
        this.lastActivityAt = now;
      }
    }
    this.emit();
    this.schedule();
  }

  private startWarning(now: number) {
    const warningId = this.deps.newId?.() ?? `${this.deps.selfId}-${now}`;
    this.state = "WARNING";
    this.warningId = warningId;
    this.deadlineAt = now + WARNING_DURATION_MS;
    this.deps.send({
      type: "MEETING_IDLE_WARNING",
      warningId,
      zoneId: this.zoneId!,
      issuedAt: now,
      deadlineAt: this.deadlineAt,
      coordinatorId: this.deps.selfId,
    });
    this.tel("MEETING_IDLE_WARNING_STARTED", { participantCount: this.participants.size });
    this.deps.onWarning?.(this.deadlineAt);
    this.emit();
  }

  private cancelWarning(reason: MeetingIdleCancelReason) {
    const id = this.warningId;
    this.closeWarning();
    this.lastActivityAt = this.now();
    if (id)
      this.deps.send({
        type: "MEETING_IDLE_CANCEL",
        warningId: id,
        zoneId: this.zoneId!,
        from: this.deps.selfId,
        reason,
      });
    if (reason !== "warn_expired") this.tel("MEETING_IDLE_WARNING_CANCELLED", { reason });
    this.emit();
    this.schedule();
  }

  private expire() {
    if (this.deps.mode === "warn") {
      this.tel("MEETING_IDLE_WOULD_EJECT", { participantCount: this.participants.size });
      this.cancelWarning("warn_expired");
      return;
    }
    const id = this.warningId!;
    this.deps.send({
      type: "MEETING_IDLE_EJECT",
      warningId: id,
      zoneId: this.zoneId!,
      coordinatorId: this.deps.selfId,
    });
    this.doEject();
  }

  private doEject() {
    const zone = this.zoneId!;
    this.state = "EJECTING";
    this.clear();
    this.tel("MEETING_IDLE_EJECTED", { reason: "idle_timeout" });
    this.emit();
    this.deps.onEject(zone);
  }

  private closeWarning() {
    this.state = "ACTIVE";
    this.warningId = null;
    this.deadlineAt = null;
  }

  private clear() {
    if (this.timer !== null) {
      (this.deps.clearTimer ?? ((h) => globalThis.clearTimeout(h as number)))(this.timer);
      this.timer = null;
    }
  }

  /** Um único timer até o próximo instante relevante (só gatilho). */
  private schedule() {
    this.clear();
    if (this.disposed || this.state === "DISABLED" || this.state === "EJECTING") return;
    const now = this.now();
    let due = this.lastActivityAt + IDLE_TIMEOUT_MS;
    if (this.state === "WARNING" && this.deadlineAt !== null)
      due = this.isCoordinator() ? this.deadlineAt : this.deadlineAt + FOLLOWER_STALE_MS;
    for (const since of this.speakingSince.values())
      due = Math.min(due, Math.max(since + SPEAKING_THRESHOLD_MS, now + SPEAKING_REFRESH_MS));
    const ms = Math.max(50, due - now);
    this.timer = (this.deps.setTimer ?? ((fn, t) => globalThis.setTimeout(fn, t)))(
      () => {
        this.timer = null;
        this.tick();
      },
      ms,
    );
  }

  private emit() {
    this.deps.onChange?.(this.getSnapshot());
  }

  private tel(type: MeetingIdleTelemetry, meta: Record<string, unknown>) {
    try {
      this.deps.telemetry?.(type, { ...meta, zoneId: this.zoneId });
    } catch {
      /* telemetria nunca altera comportamento */
    }
  }
}

// ---------- Return position ----------

export interface Pt {
  x: number;
  y: number;
}

/**
 * meetingReturnPosition: última posição segura FORA de sala privada, congelada
 * ao entrar numa sala privada. Local, por sessão.
 */
export class MeetingReturnPosition {
  private lastSafe: Pt | null = null;
  private captured: Pt | null = null;
  private inPrivate = false;

  observe(p: Pt, inPrivateRoom: boolean): void {
    if (!inPrivateRoom) {
      this.lastSafe = { x: p.x, y: p.y };
      this.inPrivate = false;
      this.captured = null;
      return;
    }
    if (!this.inPrivate) {
      this.inPrivate = true;
      this.captured = this.lastSafe;
    }
  }

  /** Retorna o destino e se foi usado o fallback. */
  resolve(fallback: Pt): { point: Pt; fallback: boolean } {
    const p = this.captured ?? null;
    return p ? { point: p, fallback: false } : { point: fallback, fallback: true };
  }
}
