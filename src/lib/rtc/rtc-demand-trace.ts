/**
 * RTC On Demand — trace de diagnóstico SOMENTE LEITURA (opt-in).
 *
 * Ligada apenas com VITE_RTC_ON_DEMAND_TRACE=true. Desligada = zero logs.
 * Loga no console só quando o snapshot muda (sem polling/timer, sem
 * coordenadas, sem persistência, sem tokens).
 */

export function isRtcDemandTraceEnabled(): boolean {
  // Acesso direto: o Vite só injeta VITE_* nesse padrão.
  const raw = import.meta.env.VITE_RTC_ON_DEMAND_TRACE;
  return typeof raw === "string" && raw.trim().toLowerCase() === "true";
}

export interface RtcDemandTraceSnapshot {
  client: string;
  myZone: { id: string | null; name: string | null };
  myMediaLocation: string | null;
  remoteMediaLocations: Record<string, string | null>;
  presenceOccupantCount: number;
  livekitRemoteCount: number;
  occupantCount: number;
  rtcDemand: string;
  activeContext: string;
  desiredContext: string;
  soloGraceState: "ARMED" | "IDLE";
  nearbyLobbyPeerCount?: number;
  lobbyGraceState?: "ARMED" | "IDLE";
  recordingActive: boolean;
}

/** Identificador curto e anônimo (não reversível na prática) para distinguir clientes. */
export function shortId(id: string): string {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36).slice(0, 5);
}

function ts(): string {
  const d = new Date();
  const p = (n: number, l = 2) => String(n).padStart(l, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

export class RtcDemandTrace {
  private last = "";
  constructor(private readonly enabled = isRtcDemandTraceEnabled()) {}
  get on(): boolean {
    return this.enabled;
  }
  record(snap: RtcDemandTraceSnapshot): void {
    if (!this.enabled) return;
    const key = JSON.stringify(snap);
    if (key === this.last) return;
    this.last = key;
    // eslint-disable-next-line no-console
    console.info(`[RTC-DEMAND-TRACE][${ts()}]`, snap);
  }
}
