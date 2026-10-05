// RTC v2 Etapa 13/13B — Meeting tracker administrativo.
//
// Fonte de verdade: o estado do LiveKitRoomManager (status + contexto da Room
// conectada). Nunca posição, peers, Presence ou meeting_participants.
//
// Regras:
//  - join somente quando status === CONNECTED e a Room conectada é PRIVATE_ROOM(zoneId);
//  - RECONNECTING da MESMA Room preserva a participação (sem leave/join);
//  - mudança de contexto, disconnect terminal, ERROR, runtime desmontado
//    (takeover) ou dispose → exatamente um leave lógico;
//  - A → B: leave A, e join B somente depois de B CONNECTED;
//  - operações serializadas num único loop; idempotente a eventos repetidos;
//  - falha de RPC é apenas logada: nunca toca mídia, contexto ou Room.
//
// Retry administrativo (13B), limitado: tentativa inicial + RETRY_DELAYS_MS.
//  - join: antes de cada retry revalida CONNECTED na MESMA zona; sair/trocar/
//    takeover/unmount cancela o retry pendente. Esgotado → para até a zona mudar.
//  - leave: meeting_leave é idempotente (UPDATE ... WHERE left_at IS NULL),
//    então também tem retry limitado; NÃO é cancelado por unmount, para não
//    deixar participação órfã.

import type { MediaContext } from "@/lib/rtc/media-context";
import type { RoomManagerStatus } from "@/lib/rtc/livekit-room-manager";

export interface MeetingRoomState {
  status: RoomManagerStatus | null;
  connected: MediaContext | null;
  /**
   * RTC On Demand: participantes humanos remotos na Room. Quando informado,
   * a reunião só começa com >= 1 remoto (2 humanos). Já iniciada, permanece
   * até a Room cair (continuidade de 15s é só administrativa: ADMIN_LEAVE_GRACE_MS).
   */
  remoteCount?: number;
}

export const RETRY_DELAYS_MS = [1000, 3000, 8000] as const;
/**
 * Continuidade ADMINISTRATIVA: ao perder a Room privada (sem trocar para outra
 * zona), espera até 15s antes do leave; voltar à mesma zona continua o mesmo
 * registro. Puramente histórico — nunca mantém LiveKit conectado.
 */
export const ADMIN_LEAVE_GRACE_MS = 15_000;

export interface MeetingTrackerDeps {
  /** Retorna o id da participação/reunião ou null. Pode lançar. */
  join(zoneId: string): Promise<string | null>;
  leave(meetingId: string): Promise<void>;
  onError?(op: "join" | "leave", err: unknown, attempt: number, final: boolean): void;
  onChange?(meetingId: string | null): void;
  /** Injetável em testes. */
  setTimeout?(fn: () => void, ms: number): unknown;
  clearTimeout?(h: unknown): void;
  /** Sobrescreve ADMIN_LEAVE_GRACE_MS (0 = leave imediato). */
  adminGraceMs?: number;
}

export class MeetingTrackerV2 {
  private desired: string | null = null;
  private connectedNow = false;
  private joinedZone: string | null = null;
  private meetingId: string | null = null;
  private failedZone: string | null = null;
  private joinAttempts = 0;
  private attemptsZone: string | null = null;
  private running = false;
  private disposed = false;
  private idle: Promise<void> = Promise.resolve();
  private wake: (() => void) | null = null;
  /** Encerramento explícito (idle_timeout): zona bloqueada até a Room sair dela. */
  private blockedZone: string | null = null;
  private skipGrace = false;

  constructor(private readonly deps: MeetingTrackerDeps) {}

  getMeetingId(): string | null {
    return this.meetingId;
  }

  whenIdle(): Promise<void> {
    return this.idle;
  }

  observe(s: MeetingRoomState | null): void {
    if (this.disposed) return;
    let zone =
      s?.connected?.kind === "PRIVATE_ROOM" ? (s.connected as { zoneId: string }).zoneId : null;
    if (this.blockedZone !== null) {
      if (zone === this.blockedZone) zone = null;
      else this.blockedZone = null;
    }
    let next: string | null = null;
    const canJoin =
      s?.remoteCount === undefined || s.remoteCount > 0 || (zone !== null && zone === this.joinedZone);
    if (zone && s?.status === "CONNECTED" && canJoin) next = zone;
    else if (zone && s?.status === "RECONNECTING" && zone === this.desired) next = zone;
    const wasConnected = this.connectedNow;
    this.connectedNow = next !== null && s?.status === "CONNECTED";
    if (next !== this.desired) {
      this.desired = next;
      if (next !== this.failedZone) this.failedZone = null;
      this.attemptsZone = null;
      this.interrupt();
    } else if (wasConnected && !this.connectedNow) {
      this.interrupt();
    }
    this.kick();
  }

  /**
   * Encerramento EXPLÍCITO (ex.: Meeting Inactivity Guard → idle_timeout):
   * leave imediato, sem o grace administrativo de 15s. A mesma zona fica
   * bloqueada até a Room deixar de estar nela — voltar depois = nova reunião.
   * Nunca toca mídia/Room.
   */
  endNow(): void {
    if (this.disposed) return;
    const z = this.joinedZone ?? this.desired;
    if (!z) return;
    this.blockedZone = z;
    this.skipGrace = true;
    this.desired = null;
    this.connectedNow = false;
    this.interrupt();
    this.kick();
  }

  dispose(): Promise<void> {
    if (!this.disposed) {
      this.disposed = true;
      this.desired = null;
      this.connectedNow = false;
      this.interrupt();
      this.kick();
    }
    return this.idle;
  }

  private interrupt(): void {
    const w = this.wake;
    this.wake = null;
    w?.();
  }

  /** Espera ms; resolve cedo (false) se interrompido. */
  private sleep(ms: number, interruptible: boolean): Promise<boolean> {
    const st = this.deps.setTimeout ?? ((fn, t) => globalThis.setTimeout(fn, t));
    const ct = this.deps.clearTimeout ?? ((h) => globalThis.clearTimeout(h as number));
    return new Promise((resolve) => {
      const h = st(() => {
        if (interruptible) this.wake = null;
        resolve(true);
      }, ms);
      if (interruptible)
        this.wake = () => {
          ct(h);
          resolve(false);
        };
    });
  }

  private kick(): void {
    if (this.running) return;
    this.running = true;
    this.idle = this.loop().finally(() => {
      this.running = false;
    });
  }

  private setMeeting(id: string | null): void {
    this.meetingId = id;
    this.deps.onChange?.(id);
  }

  private async doLeave(id: string): Promise<void> {
    for (let attempt = 0; ; attempt++) {
      try {
        await this.deps.leave(id);
        return;
      } catch (e) {
        const final = attempt >= RETRY_DELAYS_MS.length;
        this.deps.onError?.("leave", e, attempt + 1, final);
        if (final) return;
        await this.sleep(RETRY_DELAYS_MS[attempt], false);
      }
    }
  }

  private async loop(): Promise<void> {
    for (;;) {
      const d = this.desired;
      if (this.joinedZone && this.joinedZone !== d) {
        const graceMs = this.deps.adminGraceMs ?? ADMIN_LEAVE_GRACE_MS;
        if (d === null && !this.disposed && graceMs > 0 && !this.skipGrace) {
          const zone = this.joinedZone;
          const expired = await this.sleep(graceMs, true);
          if (!expired) continue; // algo mudou: reavalia (voltou, trocou ou dispose)
          if (this.desired === zone) continue;
        }
        const id = this.meetingId;
        this.skipGrace = false;
        this.joinedZone = null;
        this.setMeeting(null);
        if (id) await this.doLeave(id);
        continue;
      }
      if (d && !this.joinedZone && this.connectedNow && d !== this.failedZone) {
        if (this.attemptsZone !== d) {
          this.attemptsZone = d;
          this.joinAttempts = 0;
        }
        if (this.joinAttempts > 0) {
          const ok = await this.sleep(RETRY_DELAYS_MS[this.joinAttempts - 1], true);
          if (!ok || this.desired !== d || !this.connectedNow || this.disposed) continue;
        }
        let id: string | null = null;
        let err: unknown = null;
        try {
          id = await this.deps.join(d);
        } catch (e) {
          err = e;
        }
        if (id) {
          // Mesmo que o usuário já tenha saído, registra para que o leave aconteça.
          this.joinedZone = d;
          this.setMeeting(id);
          this.attemptsZone = null;
        } else {
          this.joinAttempts++;
          const final = this.joinAttempts > RETRY_DELAYS_MS.length;
          this.deps.onError?.(
            "join",
            err ?? new Error("meeting_join sem id"),
            this.joinAttempts,
            final,
          );
          if (final) this.failedZone = d;
        }
        continue;
      }
      return;
    }
  }
}
