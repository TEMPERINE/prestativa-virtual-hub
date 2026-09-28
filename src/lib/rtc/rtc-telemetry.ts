/**
 * RTC v2 — Etapa 11: telemetria (observabilidade, NUNCA autoridade).
 *
 * - record() é síncrono: só enfileira em memória. Falhas de envio nunca
 *   propagam para o chamador (Room, mídia, movimento e sessão seguem).
 * - Batch de TELEMETRY_BATCH_SIZE eventos ou a cada TELEMETRY_FLUSH_MS; flush final no dispose().
 * - Fila limitada (TELEMETRY_MAX_BUFFERED); excesso descarta os mais antigos (droppedEvents).
 * - Retry controlado: backoff exponencial a partir do intervalo de flush, teto de 30 s.
 * - eventSeq monotônico por sessão (sessionId+generation), reinicia só em nova sessão.
 * - user_id NUNCA é enviado: a coluna usa DEFAULT auth.uid() e a policy exige user_id = auth.uid().
 * - Metadata passa por allowlist + limites + redaction de segredos (token, JWT, SDP, ICE, IP, e-mail).
 * - Movimento normal não é tipo aceito.
 *
 * ROOM_SIGNAL_CONNECTED: sinalização LiveKit conectada (room.connect() resolveu).
 * ROOM_MEDIA_ACTIVE: reservado para evidência REAL de mídia utilizável — track
 *   local publicada com sucesso OU track remota inscrita recebendo dados. Nunca
 *   emitir só porque connect() resolveu. Instrumentação concreta fica para depois.
 *
 * Ainda não integrado a nenhum módulo real.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export const RTC_TELEMETRY_EVENT_TYPES = [
  "SESSION_CLAIMED",
  "SESSION_REPLACED",
  "CONTEXT_CHANGE_REQUESTED",
  "CONTEXT_CHANGED",
  "ROOM_CONNECT_REQUESTED",
  "ROOM_SIGNAL_CONNECTED",
  "ROOM_MEDIA_ACTIVE",
  "ROOM_RECONNECTING",
  "ROOM_RECONNECTED",
  "ROOM_DISCONNECTED",
  "ROOM_CONNECT_FAILED",
  "MIC_ON",
  "MIC_OFF",
  "MIC_ERROR",
  "CAM_ON",
  "CAM_OFF",
  "CAM_ERROR",
  "SCREEN_SHARE_ON",
  "SCREEN_SHARE_OFF",
  "MAP_STALE",
  "PRESENCE_ERROR",
  "BROADCAST_ERROR",
] as const;

export type RtcTelemetryEventType = (typeof RTC_TELEMETRY_EVENT_TYPES)[number];

const EVENT_TYPE_SET = new Set<string>(RTC_TELEMETRY_EVENT_TYPES);

export const TELEMETRY_BATCH_SIZE = 10;
export const TELEMETRY_FLUSH_MS = 2000;
export const TELEMETRY_MAX_BUFFERED = 100;
export const TELEMETRY_MAX_RETRY_DELAY_MS = 30_000;
export const TELEMETRY_MAX_STRING = 200;

/** Únicas chaves de metadata aceitas. Valores: string/number/boolean/null. */
export const TELEMETRY_METADATA_KEYS = new Set([
  "reason",
  "attempt",
  "durationMs",
  "participantCount",
  "trackKind",
  "trackSource",
  "previousContext",
  "previousZoneId",
  "fromGeneration",
  "toGeneration",
  "channel",
  "status",
  "quality",
  "retryInMs",
  "engine",
]);

export interface TelemetrySession {
  workspaceId: string | null;
  sessionId: string | null;
  generation: number | null;
}

export interface TelemetryFields {
  context?: string | null;
  zoneId?: string | null;
  roomName?: string | null;
  connectionState?: string | null;
  disconnectReason?: string | null;
  mapVersion?: number | null;
  metadata?: Record<string, unknown>;
  error?: unknown;
  /**
   * Opcional: se igual ao último dedupeKey registrado para o mesmo tipo,
   * o evento é ignorado (protege contra re-render do React). Sem dedupeKey,
   * chamadas repetidas são eventos distintos.
   */
  dedupeKey?: string;
}

/** Linha exatamente no formato de public.rtc_events (sem user_id). */
export interface RtcEventRow {
  session_id: string | null;
  generation: number | null;
  workspace_id: string | null;
  zone_id: string | null;
  map_version: number | null;
  context: string | null;
  room_name: string | null;
  event_type: RtcTelemetryEventType;
  connection_state: string | null;
  disconnect_reason: string | null;
  details: Record<string, string | number | boolean | null>;
}

export interface TelemetryAdapter {
  insertEvents(rows: RtcEventRow[]): Promise<void>;
}

export interface TelemetryDiagnostics {
  buffered: number;
  persisted: number;
  failures: number;
  droppedEvents: number;
  rejectedEvents: number;
  lastError: string | null;
}

// ─── Sanitização ───────────────────────────────────────────────

const JWT_RE = /eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/;
const SDP_RE = /(^|\s)(v=0|o=-|a=(candidate|fingerprint|ice-ufrag|ice-pwd)|m=(audio|video))/i;
const ICE_RE = /candidate:\S*\s+\d+\s+(udp|tcp)/i;
const IPV4_RE = /\b(?:\d{1,3}\.){3}\d{1,3}\b/;
const IPV6_RE = /\b(?:[0-9a-f]{1,4}:){3,7}[0-9a-f]{1,4}\b/i;
const EMAIL_RE = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const SECRET_WORD_RE = /(api[_-]?secret|api[_-]?key|secret|token|password|senha|bearer|authorization)\s*[:=]?\s*\S+/i;
const LIVEKIT_KEY_RE = /\b(API|sk|sb_secret|sb_publishable)[_A-Za-z0-9]{8,}\b/;
const LONG_OPAQUE_RE = /[A-Za-z0-9+/_=-]{40,}/;
const PHONE_RE = /\+?\d[\d\s().-]{8,}\d/;

export function isSensitiveString(s: string): boolean {
  return (
    JWT_RE.test(s) ||
    SDP_RE.test(s) ||
    ICE_RE.test(s) ||
    IPV4_RE.test(s) ||
    IPV6_RE.test(s) ||
    EMAIL_RE.test(s) ||
    SECRET_WORD_RE.test(s) ||
    LIVEKIT_KEY_RE.test(s) ||
    LONG_OPAQUE_RE.test(s) ||
    PHONE_RE.test(s)
  );
}

/** String segura e curta, ou null se sensível. */
export function sanitizeString(v: unknown, max = TELEMETRY_MAX_STRING): string | null {
  if (typeof v !== "string") return null;
  const trimmed = v.slice(0, max);
  if (isSensitiveString(v) || isSensitiveString(trimmed)) return "[redacted]";
  return trimmed;
}

export function sanitizeMetadata(
  input: Record<string, unknown> | undefined,
): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  if (!input || typeof input !== "object") return out;
  for (const key of Object.keys(input).slice(0, 32)) {
    if (!TELEMETRY_METADATA_KEYS.has(key)) continue;
    const v = input[key];
    if (v === null || typeof v === "boolean") out[key] = v;
    else if (typeof v === "number") out[key] = Number.isFinite(v) ? v : null;
    else if (typeof v === "string") out[key] = sanitizeString(v);
    // objetos/arrays/funções: descartados
  }
  return out;
}

/** Apenas código/categoria + mensagem sanitizada; nunca o objeto cru. */
export function sanitizeError(err: unknown): { errorCode: string | null; errorMessage: string | null } {
  if (err == null) return { errorCode: null, errorMessage: null };
  let code: unknown = null;
  let message: unknown = null;
  if (typeof err === "string") message = err;
  else if (typeof err === "object") {
    const e = err as { name?: unknown; code?: unknown; message?: unknown };
    code = typeof e.code === "string" || typeof e.code === "number" ? String(e.code) : e.name;
    message = e.message;
  }
  return {
    errorCode: sanitizeString(code, 64),
    errorMessage: sanitizeString(message),
  };
}

// ─── Núcleo ────────────────────────────────────────────────────

export interface RtcTelemetryOptions {
  adapter: TelemetryAdapter;
  session: TelemetrySession;
  now?: () => number;
}

export class RtcTelemetry {
  private readonly adapter: TelemetryAdapter;
  private readonly now: () => number;
  private session: TelemetrySession;
  private eventSeq = 0;
  private queue: RtcEventRow[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight: Promise<void> | null = null;
  private consecutiveFailures = 0;
  private disposed = false;
  private lastDedupe = new Map<string, string>();
  private diag: TelemetryDiagnostics = {
    buffered: 0,
    persisted: 0,
    failures: 0,
    droppedEvents: 0,
    rejectedEvents: 0,
    lastError: null,
  };

  constructor(opts: RtcTelemetryOptions) {
    this.adapter = opts.adapter;
    this.session = { ...opts.session };
    this.now = opts.now ?? Date.now;
  }

  /** Troca de sessão reinicia eventSeq; mesma sessão mantém. */
  setSession(next: TelemetrySession): void {
    const changed =
      next.sessionId !== this.session.sessionId || next.generation !== this.session.generation;
    this.session = { ...next };
    if (changed) {
      this.eventSeq = 0;
      this.lastDedupe.clear();
    }
  }

  get diagnostics(): Readonly<TelemetryDiagnostics> {
    return { ...this.diag, buffered: this.queue.length };
  }

  /** Síncrono, nunca lança, nunca aguarda o banco. */
  record(type: RtcTelemetryEventType, fields: TelemetryFields = {}): void {
    try {
      if (this.disposed) return;
      if (!EVENT_TYPE_SET.has(type)) {
        this.diag.rejectedEvents++;
        return;
      }
      if (fields.dedupeKey !== undefined) {
        if (this.lastDedupe.get(type) === fields.dedupeKey) return;
        this.lastDedupe.set(type, fields.dedupeKey);
      }
      const { errorCode, errorMessage } = sanitizeError(fields.error);
      const details: RtcEventRow["details"] = {
        ...sanitizeMetadata(fields.metadata),
        eventSeq: ++this.eventSeq,
        clientTs: this.now(),
      };
      if (errorCode !== null) details.errorCode = errorCode;
      if (errorMessage !== null) details.errorMessage = errorMessage;

      this.enqueue({
        session_id: this.session.sessionId,
        generation: this.session.generation,
        workspace_id: this.session.workspaceId,
        zone_id: sanitizeString(fields.zoneId ?? null, 100),
        map_version: typeof fields.mapVersion === "number" ? fields.mapVersion : null,
        context: sanitizeString(fields.context ?? null, 64),
        room_name: sanitizeString(fields.roomName ?? null, 150),
        event_type: type,
        connection_state: sanitizeString(fields.connectionState ?? null, 32),
        disconnect_reason: sanitizeString(fields.disconnectReason ?? null, 64),
        details,
      });
    } catch {
      /* telemetria nunca derruba o chamador */
    }
  }

  /** Envia um batch. Nunca rejeita. */
  flush(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    if (this.queue.length === 0) return Promise.resolve();
    this.clearTimer();
    const batch = this.queue.splice(0, TELEMETRY_BATCH_SIZE);
    const p = (async () => {
      try {
        await this.adapter.insertEvents(batch);
        this.diag.persisted += batch.length;
        this.consecutiveFailures = 0;
      } catch (e) {
        this.diag.failures++;
        this.consecutiveFailures++;
        this.diag.lastError = sanitizeError(e).errorMessage ?? "insert failed";
        if (!this.disposed) {
          // devolve para a frente respeitando o limite
          this.queue = [...batch, ...this.queue];
          this.trim();
        }
      }
    })().finally(() => {
      this.inFlight = null;
      if (!this.disposed && this.queue.length > 0) this.schedule();
    });
    this.inFlight = p;
    return p;
  }

  /** Flush final best-effort (uma tentativa por batch), cancela timers. */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.clearTimer();
    if (this.inFlight) await this.inFlight;
    this.disposed = true;
    this.clearTimer();
    while (this.queue.length > 0) {
      const batch = this.queue.splice(0, TELEMETRY_BATCH_SIZE);
      try {
        await this.adapter.insertEvents(batch);
        this.diag.persisted += batch.length;
      } catch (e) {
        this.diag.failures++;
        this.diag.lastError = sanitizeError(e).errorMessage ?? "insert failed";
        this.diag.droppedEvents += batch.length + this.queue.length;
        this.queue = [];
      }
    }
  }

  // ─── internos ──────────────────────────────────────────────

  private enqueue(row: RtcEventRow): void {
    this.queue.push(row);
    this.trim();
    if (this.queue.length >= TELEMETRY_BATCH_SIZE && this.consecutiveFailures === 0) {
      void this.flush();
    } else {
      this.schedule();
    }
  }

  private trim(): void {
    const over = this.queue.length - TELEMETRY_MAX_BUFFERED;
    if (over > 0) {
      this.queue.splice(0, over);
      this.diag.droppedEvents += over;
    }
  }

  private schedule(): void {
    if (this.timer || this.disposed || this.inFlight) return;
    const delay = Math.min(
      TELEMETRY_FLUSH_MS * 2 ** this.consecutiveFailures,
      TELEMETRY_MAX_RETRY_DELAY_MS,
    );
    this.timer = setTimeout(() => {
      this.timer = null;
      if (!this.disposed) void this.flush();
    }, delay);
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}

/** Adapter de produção para public.rtc_events. user_id vem de auth.uid() (DEFAULT + policy). */
export function createSupabaseTelemetryAdapter(supabase: SupabaseClient): TelemetryAdapter {
  return {
    async insertEvents(rows) {
      if (rows.length === 0) return;
      const { error } = await supabase.from("rtc_events").insert(rows);
      if (error) throw new Error(error.message);
    },
  };
}
