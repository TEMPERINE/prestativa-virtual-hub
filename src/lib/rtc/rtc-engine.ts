/**
 * Seleção do motor RTC.
 *
 * Regra por domínio (o site publicado nunca liga V2 por engano):
 *  - domínio de PREVIEW do Lovable → valor de VITE_RTC_ENGINE (hoje "v2");
 *  - domínio publicado (prestativa-virtual-hub.lovable.app) → sempre "v1";
 *  - qualquer outro domínio (ou sem window, ex.: SSR) → sempre "v1".
 */

export type RtcEngine = "v1" | "v2";

export const DEFAULT_RTC_ENGINE: RtcEngine = "v1";

export function parseRtcEngine(raw?: string | null | undefined): RtcEngine {
  const value = (raw ?? "").toString().trim().toLowerCase();
  if (value === "v2") return "v2";
  if (value === "v1") return "v1";
  return DEFAULT_RTC_ENGINE;
}

/** Hosts de preview do Lovable (id-preview--*, project--*-dev, *.lovableproject.com). */
export function isLovablePreviewHost(hostname: string | null | undefined): boolean {
  const h = (hostname ?? "").toLowerCase();
  if (!h) return false;
  if (h.endsWith(".lovableproject.com")) return true;
  if (!h.endsWith(".lovable.app")) return false;
  const sub = h.slice(0, -".lovable.app".length);
  return sub.startsWith("id-preview--") || /^project--.+-dev$/.test(sub) || sub.startsWith("preview--");
}

/** Pura: decide o motor a partir do host e do valor bruto da flag. */
export function resolveRtcEngine(hostname: string | null | undefined, raw?: string | null): RtcEngine {
  return isLovablePreviewHost(hostname) ? parseRtcEngine(raw) : "v1";
}

export function getRtcEngine(): RtcEngine {
  const raw = import.meta?.env?.VITE_RTC_ENGINE;
  const host = typeof window !== "undefined" ? window.location.hostname : null;
  return resolveRtcEngine(host, typeof raw === "string" ? raw : undefined);
}
