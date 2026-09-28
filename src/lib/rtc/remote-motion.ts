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
  maxExtrapolateMs: 2500,
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
}

export type IngestResult = "new" | "jump" | "correction" | "ignored";

export class RemoteMotionPredictor {
  private tracks = new Map<string, Track>();

  ingest(a: RemoteMotionInput, now: number): IngestResult {
    const prev = this.tracks.get(a.userId);
    if (prev) {
      if (a.generation < prev.generation) return "ignored";
      if (a.generation === prev.generation && a.sessionId === prev.sessionId && a.seq <= prev.seq)
        return "ignored";
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
    };
    if (!prev || a.jump) {
      this.tracks.set(a.userId, base);
      return prev ? "jump" : "new";
    }
    const cur = this.sampleTrack(prev, now);
    base.cx = cur.x - a.x;
    base.cy = cur.y - a.y;
    if (Math.hypot(base.cx, base.cy) > REMOTE_MOTION.largeDrift)
      base.tau = REMOTE_MOTION.fastCorrectionTauMs;
    this.tracks.set(a.userId, base);
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
