// Celebração coletiva do sino — lógica pura (sem React/Realtime) para testes.
// Transporte: o mesmo canal Broadcast do sino (`props-bcast-{workspaceId}`),
// evento `bell_celebration`. O som continua vindo exclusivamente do `prop_tick`
// existente, então cada celebração toca o sino uma única vez por cliente.
// Identidade: o payload carrega só `senderId` (do usuário autenticado); o nome
// exibido é sempre resolvido pelo receptor no perfil — nunca vem do payload.

export const CELEBRATION_MAX_LEN = 140;
export const CELEBRATION_COOLDOWN_MS = 20_000;
export const CELEBRATION_TOAST_MS = 12_000;
export const CELEBRATION_PENDING_TTL_MS = 5 * 60_000;
export const CELEBRATION_EVENT = "bell_celebration";

export const CELEBRATION_REASONS = [
  { id: "meta", label: "Meta batida" },
  { id: "elogio", label: "Elogio do cliente" },
  { id: "conquista", label: "Conquista" },
  { id: "outro", label: "Outro" },
] as const;
export type CelebrationReason = (typeof CELEBRATION_REASONS)[number]["id"];

export type CelebrationEvent = {
  celebrationId: string;
  workspaceId: string;
  senderId: string;
  reason: CelebrationReason | null;
  message: string;
  at: number;
};

/** Texto puro: remove tags/controles, colapsa espaços e limita tamanho. */
export function sanitizeCelebrationMessage(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw
    .replace(/<[^>]*>/g, "")
    .replace(/[<>]/g, "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, CELEBRATION_MAX_LEN);
}

export function canSubmitCelebration(raw: string): boolean {
  return sanitizeCelebrationMessage(raw).length > 0;
}

export function newCelebrationId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  return c?.randomUUID ? c.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function buildCelebration(input: {
  workspaceId: string; senderId: string; reason?: string | null; message: string; at: number; id?: string;
}): CelebrationEvent | null {
  const message = sanitizeCelebrationMessage(input.message);
  if (!message || !input.workspaceId || !input.senderId) return null;
  const reason = CELEBRATION_REASONS.some((r) => r.id === input.reason) ? (input.reason as CelebrationReason) : null;
  return { celebrationId: input.id ?? newCelebrationId(), workspaceId: input.workspaceId, senderId: input.senderId, reason, message, at: input.at };
}

/** Valida payload remoto; descarta campos extras (ex.: senderName). */
export function parseCelebration(payload: unknown): CelebrationEvent | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  if (typeof p.celebrationId !== "string" || !p.celebrationId || p.celebrationId.length > 80) return null;
  if (typeof p.workspaceId !== "string" || typeof p.senderId !== "string") return null;
  return buildCelebration({
    id: p.celebrationId, workspaceId: p.workspaceId, senderId: p.senderId,
    reason: typeof p.reason === "string" ? p.reason : null,
    message: typeof p.message === "string" ? p.message : "",
    at: typeof p.at === "number" ? p.at : 0,
  });
}

export type ShownCelebration = CelebrationEvent & { missed: boolean };

export function createCelebrationCenter(deps: {
  workspaceId: () => string | null;
  isBackground: () => boolean;
  show: (c: ShownCelebration) => void;
  now?: () => number;
}) {
  const now = deps.now ?? (() => Date.now());
  const seen = new Set<string>();
  const lastSent = new Map<string, number>();
  let pending: { c: CelebrationEvent; at: number } | null = null;

  return {
    cooldownRemaining(userId: string): number {
      const t = lastSent.get(userId);
      return t === undefined ? 0 : Math.max(0, CELEBRATION_COOLDOWN_MS - (now() - t));
    },
    /** Registra envio local. Retorna false se ainda em cooldown. */
    trySend(userId: string, c: CelebrationEvent): boolean {
      if (this.cooldownRemaining(userId) > 0) return false;
      lastSent.set(userId, now());
      seen.add(c.celebrationId);
      deps.show({ ...c, missed: false });
      return true;
    },
    receive(payload: unknown): "shown" | "pending" | "duplicate" | "ignored" {
      const c = parseCelebration(payload);
      if (!c || c.workspaceId !== deps.workspaceId()) return "ignored";
      if (seen.has(c.celebrationId)) return "duplicate";
      seen.add(c.celebrationId);
      if (deps.isBackground()) { pending = { c, at: now() }; return "pending"; }
      deps.show({ ...c, missed: false });
      return "shown";
    },
    /** Chamado quando o Office volta ao foco. */
    onForeground(): boolean {
      const p = pending; pending = null;
      if (!p || now() - p.at > CELEBRATION_PENDING_TTL_MS) return false;
      deps.show({ ...p.c, missed: true });
      return true;
    },
  };
}
