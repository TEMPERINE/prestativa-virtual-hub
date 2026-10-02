/**
 * RTC v2 — tipos da telemetria (sem dependências) + sink opcional injetável.
 * Módulos RTC importam somente daqui; o adapter Supabase fica em rtc-telemetry.ts.
 */

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
  // Etapa 14A — diagnóstico de áudio (somente observação)
  "AUDIO_LOCAL_TRACK",
  "AUDIO_LOCAL_PUB",
  "AUDIO_MIC_SWAP",
  "AUDIO_REMOTE_TRACK",
  "AUDIO_TX_STATS",
  "AUDIO_RX_STATS",
  "AUDIO_SNAPSHOT",
  // Fase 3 — Privacy Guard
  "PRIVACY_GUARD_ARMED",
  "PRIVACY_GUARD_CANCELLED",
  "PRIVACY_GUARD_SUSPENDED",
  "PRIVACY_GUARD_RESTORED",
  "PRIVACY_GUARD_KEEP_OFF",
  "PRIVACY_GUARD_SKIPPED_SCREEN_SHARE",
] as const;

export type RtcTelemetryEventType = (typeof RTC_TELEMETRY_EVENT_TYPES)[number];

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
  /** Se igual ao último dedupeKey do mesmo tipo, o evento é ignorado. */
  dedupeKey?: string;
  /** Define/atualiza a sessão associada ANTES de registrar este evento. */
  session?: TelemetrySession;
}

/** Interface mínima que os módulos recebem por injeção (opcional). */
export interface RtcTelemetrySink {
  record(type: RtcTelemetryEventType, fields?: TelemetryFields): void;
}

/** Chamada segura: sem sink = no-op; exceção do sink nunca propaga. */
export function emitTelemetry(
  sink: RtcTelemetrySink | null | undefined,
  type: RtcTelemetryEventType,
  fields?: TelemetryFields,
): void {
  if (!sink) return;
  try {
    sink.record(type, fields);
  } catch {
    /* telemetria nunca altera o comportamento do RTC */
  }
}

let objectKeySeq = 0;
const objectKeys = new WeakMap<object, string>();
/** Identificador estável e anônimo por objeto (ex.: Room) para dedupeKey. */
export function telemetryObjectKey(obj: object): string {
  let k = objectKeys.get(obj);
  if (!k) {
    k = `o${++objectKeySeq}`;
    objectKeys.set(obj, k);
  }
  return k;
}

export const MAP_VERSION_STALE_CODE = "MAP_VERSION_STALE";

export function isMapVersionStaleError(e: unknown): boolean {
  if (!e) return false;
  if (typeof e === "string") return e.includes(MAP_VERSION_STALE_CODE);
  if (typeof e === "object") {
    const o = e as { code?: unknown; message?: unknown };
    return (
      o.code === MAP_VERSION_STALE_CODE ||
      (typeof o.message === "string" && o.message.includes(MAP_VERSION_STALE_CODE))
    );
  }
  return false;
}
