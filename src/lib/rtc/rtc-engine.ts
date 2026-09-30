/**
 * Seleção do motor RTC — configuração única: VITE_RTC_ENGINE.
 *
 * Mesmo valor em preview e produção (sem regra por hostname).
 * Padrão = "v2". Rollback emergencial: VITE_RTC_ENGINE=v1 e republicar.
 */

export type RtcEngine = "v1" | "v2";

export const DEFAULT_RTC_ENGINE: RtcEngine = "v2";

export function parseRtcEngine(raw?: string | null | undefined): RtcEngine {
  const value = (raw ?? "").toString().trim().toLowerCase();
  if (value === "v2") return "v2";
  if (value === "v1") return "v1";
  return DEFAULT_RTC_ENGINE;
}

export function getRtcEngine(): RtcEngine {
  const raw = import.meta?.env?.VITE_RTC_ENGINE;
  return parseRtcEngine(typeof raw === "string" ? raw : undefined);
}
