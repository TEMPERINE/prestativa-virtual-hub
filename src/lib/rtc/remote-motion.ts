/**
 * RTC v2 — Etapa 12D: predição visual de avatares remotos.
 *
 * Puramente VISUAL. Recebe o estado autoritativo do Movement (x, y, vx, vy,
 * moving, seq) e calcula a posição de desenho a cada frame:
 *   visual = autoritativo + v * elapsed (se moving) + correção que decai.
 * Unidade de vx/vy: frações do mapa (0..1) por SEGUNDO — a mesma de
 * `SPEED_PER_SEC` no OfficeScene que alimenta `reportMotion`.
 *
 * POSITION_SYNC/CHANGE/STOP nunca são teleporte: a diferença entre a posição
 * prevista e a nova base vira um offset que decai suavemente. Só `jump=true`
 * (announceJump) faz snap. Não altera posição usada por RTC/proximidade.
 */

export const REMOTE_MOTION = {
  /** Constante de tempo da correção normal de drift (ms). */
  correctionTauMs: 120,
  /** Correção mais rápida quando o drift é grande (ms). */
  fastCorrectionTauMs: 50,
  /** Drift acima disso (= REMOTE_TELEPORT_MIN_DISTANCE do v1) corrige rápido. */
  largeDrift: 0.075,
  /** Sem nenhum pacote por mais que isso, para de extrapolar (perda de rede). */
  maxExtrapolateMs: 1500,
  /**
   * Etapa 14C: correção ao longo da trajetória quando o visual está À FRENTE
   * da base nova é absorvida desacelerando (nunca invertendo): o offset
   * longitudinal cai linearmente a esta fração de |v|. Visual anda a
   * (1 - absorbRate)·|v| ≥ 0 até alcançar a base — sem ré.
   */
  aheadAbsorbRate: 0.6,
  /**
   * STOP com visual à frente da posição final: recuo residual lento (ms),
   * sem salto visível. A causa principal (STOP atrasado) é evitada na origem.
   */
  stopSettleTauMs: 320,
  /** Offset residual abaixo disso é zerado (termina exatamente na posição). */
  epsilon: 1e-5,
} as const;

export interface RemoteMotionInput {
  userId: string;
  sessionId: string;
  generation: number;
  seq: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  moving: boolean;
  jump?: boolean;
}

export interface RemoteMotionSample {
  x: number;
  y: number;
  vx: number;
  vy: number;
  moving: boolean;
}

interface Track {
  sessionId: string;
  generation: number;
  seq: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  moving: boolean;
  receivedAt: number;
  cx: number;
  cy: number;
  tau: number;
  /** Componente longitudinal "à frente" (>=0), absorvida linearmente. */
  ahead: number;
}

export interface RemoteMotionTrace {
  userId: string;
  seq: number;
  generation: number;
  result: IngestResult;
  x: number;
  y: number;
  vx: number;
  vy: number;
  receivedAt: number;
  predictedX: number | null;
  predictedY: number | null;
  cx: number;
  cy: number;
  ahead: number;
  jump: boolean;
}

export type IngestResult = "new" | "jump" | "correction" | "ignored";

export class RemoteMotionPredictor {
  private tracks = new Map<string, Track>();
  /** Instrumentação opcional (diagnóstico 14C); sem efeito no cálculo. */
  constructor(private readonly trace?: (t: RemoteMotionTrace) => void) {}

  private emitTrace(a: RemoteMotionInput, result: IngestResult, now: number, t: Track | null, pred: RemoteMotionSample | null): void {
    if (!this.trace) return;
    try {
      this.trace({
        userId: a.userId, seq: a.seq, generation: a.generation, result,
        x: a.x, y: a.y, vx: a.vx, vy: a.vy, receivedAt: now,
        predictedX: pred?.x ?? null, predictedY: pred?.y ?? null,
        cx: t?.cx ?? 0, cy: t?.cy ?? 0, ahead: t?.ahead ?? 0, jump: !!a.jump,
      });
    } catch { /* noop */ }
  }

  ingest(a: RemoteMotionInput, now: number): IngestResult {
    const prev = this.tracks.get(a.userId);
    if (prev) {
      if (
        a.generation < prev.generation ||
        (a.generation === prev.generation && a.sessionId === prev.sessionId && a.seq <= prev.seq)
      ) {
        this.emitTrace(a, "ignored", now, null, null);
        return "ignored";
      }
    }
    const moving = a.moving && Math.hypot(a.vx, a.vy) > 0;
    const base: Track = {
      sessionId: a.sessionId,
      generation: a.generation,
      seq: a.seq,
      x: a.x,
      y: a.y,
      vx: moving ? a.vx : 0,
      vy: moving ? a.vy : 0,
      moving,
      receivedAt: now,
      cx: 0,
      cy: 0,
      tau: REMOTE_MOTION.correctionTauMs,
      ahead: 0,
    };
    if (!prev || a.jump) {
      this.tracks.set(a.userId, base);
      const r: IngestResult = prev ? "jump" : "new";
      this.emitTrace(a, r, now, base, null);
      return r;
    }
    const cur = this.sampleTrack(prev, now);
    let dx = cur.x - a.x;
    let dy = cur.y - a.y;
    if (Math.hypot(dx, dy) > REMOTE_MOTION.largeDrift) base.tau = REMOTE_MOTION.fastCorrectionTauMs;
    if (!moving && prev.moving) {
      const ps = Math.hypot(prev.vx, prev.vy);
      if (ps > 0 && (dx * prev.vx + dy * prev.vy) / ps > 0) base.tau = REMOTE_MOTION.stopSettleTauMs;
    }
    const speed = Math.hypot(base.vx, base.vy);
    if (moving && speed > 0) {
      // Separa a parte "à frente" ao longo de v: absorvida sem inverter.
      const ux = base.vx / speed;
      const uy = base.vy / speed;
      const along = dx * ux + dy * uy;
      if (along > 0) {
        base.ahead = along;
        dx -= along * ux;
        dy -= along * uy;
      }
    }
    base.cx = dx;
    base.cy = dy;
    this.tracks.set(a.userId, base);
    this.emitTrace(a, "correction", now, base, cur);
    return "correction";
  }

  sample(userId: string, now: number): RemoteMotionSample | null {
    const t = this.tracks.get(userId);
    return t ? this.sampleTrack(t, now) : null;
  }

  /** Posição autoritativa (sem suavização) — é a que RTC deve usar. */
  authoritative(userId: string): { x: number; y: number } | null {
    const t = this.tracks.get(userId);
    return t ? { x: t.x, y: t.y } : null;
  }

  isMoving(userId: string): boolean {
    return this.tracks.get(userId)?.moving ?? false;
  }

  forget(userId: string): void {
    this.tracks.delete(userId);
  }

  keys(): IterableIterator<string> {
    return this.tracks.keys();
  }

  private sampleTrack(t: Track, now: number): RemoteMotionSample {
    const dt = Math.max(0, now - t.receivedAt);
    const el = Math.min(dt, REMOTE_MOTION.maxExtrapolateMs) / 1000;
    const decay = Math.exp(-dt / t.tau);
    let ox = t.cx * decay;
    let oy = t.cy * decay;
    if (t.ahead > 0 && t.moving) {
      const speed = Math.hypot(t.vx, t.vy);
      const left = Math.max(0, t.ahead - speed * REMOTE_MOTION.aheadAbsorbRate * el);
      ox += (t.vx / speed) * left;
      oy += (t.vy / speed) * left;
    }
    if (Math.hypot(ox, oy) < REMOTE_MOTION.epsilon) {
      ox = 0;
      oy = 0;
    }
    return {
      x: t.x + (t.moving ? t.vx * el : 0) + ox,
      y: t.y + (t.moving ? t.vy * el : 0) + oy,
      vx: t.vx,
      vy: t.vy,
      moving: t.moving,
    };
  }
}

export function facingFromVector(
  vx: number,
  vy: number,
  fallback: "up" | "down" | "left" | "right",
): "up" | "down" | "left" | "right" {
  if (Math.abs(vx) > Math.abs(vy)) return vx > 0 ? "right" : "left";
  if (Math.abs(vy) > 0) return vy > 0 ? "down" : "up";
  return fallback;
}
