/**
 * Feature flag do motor RTC (Etapa 1 da reconstrucao RTC v2).
 *
 * Valores aceitos para VITE_RTC_ENGINE:
 *  - "v1" (default)
 *  - "v2"
 *
 * Qualquer valor ausente ou invalido resolve para "v1",
 * garantindo que o RTC v1 continue sendo o comportamento padrao.
 *
 * IMPORTANTE: nesta etapa a flag NAO seleciona nem executa nenhum motor RTC.
 * A integracao efetiva v1/v2 acontecera em etapa futura.
 */

export type RtcEngine = "v1" | "v2";

export const DEFAULT_RTC_ENGINE: RtcEngine = "v1";

/**
 * Interpreta o valor bruto de VITE_RTC_ENGINE de forma pura e deterministica.
 * Aceita "v1" e "v2" (case-insensitive, com trim).
 * Ausente, vazio ou invalido retorna "v1".
 */
export function parseRtcEngine(
  raw?: string | null | undefined,
): RtcEngine {
  const value = (raw ?? "").toString().trim().toLowerCase();
  if (value === "v2") return "v2";
  if (value === "v1") return "v1";
  return DEFAULT_RTC_ENGINE;
}

/**
 * Le a flag do ambiente de build (import.meta.env.VITE_RTC_ENGINE).
 * Nao conecta ao produto ainda; apenas expoe o valor interpretado.
 */
export function getRtcEngine(): RtcEngine {
  const raw = import.meta?.env?.VITE_RTC_ENGINE;
  return parseRtcEngine(typeof raw === "string" ? raw : undefined);
}
