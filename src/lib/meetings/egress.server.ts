/**
 * Etapa 14D — gravação server-side (LiveKit RoomComposite Egress).
 * Somente servidor: lê LIVEKIT_* e RECORDING_S3_* de process.env.
 * Nenhum valor daqui é devolvido ao browser.
 */

export const RECORDING_BUCKET_DEFAULT = "meeting-recordings";
export const TEMPLATE_BASE_DEFAULT = "https://prestativa-virtual-hub.lovable.app";

export interface S3Config {
  endpoint: string;
  region: string;
  bucket: string;
  accessKey: string;
  secret: string;
}

/** Secrets exigidos para gravar; ausentes → lista de nomes (nunca valores). */
export function readS3Config(): { ok: true; cfg: S3Config } | { ok: false; missing: string[] } {
  const env = process.env;
  // Storage externo S3-compatible (ex.: R2: https://<account>.r2.cloudflarestorage.com, region "auto").
  const endpoint = (env["RECORDING_S3_ENDPOINT"] ?? "").trim();
  const region = env["RECORDING_S3_REGION"] ?? "";
  const accessKey = env["RECORDING_S3_ACCESS_KEY_ID"] ?? "";
  const secret = env["RECORDING_S3_SECRET_ACCESS_KEY"] ?? "";
  const bucket = env["RECORDING_S3_BUCKET"] || RECORDING_BUCKET_DEFAULT;
  const missing: string[] = [];
  if (!endpoint) missing.push("RECORDING_S3_ENDPOINT");
  if (!region) missing.push("RECORDING_S3_REGION");
  if (!accessKey) missing.push("RECORDING_S3_ACCESS_KEY_ID");
  if (!secret) missing.push("RECORDING_S3_SECRET_ACCESS_KEY");
  if (missing.length) return { ok: false, missing };
  return { ok: true, cfg: { endpoint, region, bucket, accessKey, secret } };
}

export function readLiveKit() {
  const apiKey = (process.env["LIVEKIT_API_KEY"] ?? "").trim();
  const apiSecret = (process.env["LIVEKIT_API_SECRET"] ?? "").trim();
  const url = (process.env["LIVEKIT_URL"] ?? "").trim();
  if (!apiKey || !apiSecret || !url) throw new Error("LiveKit não configurado");
  // Clientes REST usam https:// em vez de wss://
  const host = url.replace(/^wss:/, "https:").replace(/^ws:/, "http:");
  return { apiKey, apiSecret, host };
}

/**
 * Token do webhook: LiveKit envia o JWT em `Authorization` (alguns proxies/versões usam `Authorize`).
 * Remove prefixo `Bearer ` — o SDK exige o JWT puro.
 */
export function extractWebhookToken(headers: Headers): { token: string; source: "authorization" | "authorize" | "none"; hadBearer: boolean } {
  const a = headers.get("authorization");
  const b = headers.get("authorize");
  const raw = (a || b || "").trim();
  const source = a ? "authorization" : b ? "authorize" : "none";
  const hadBearer = /^bearer\s+/i.test(raw);
  return { token: raw.replace(/^bearer\s+/i, ""), source, hadBearer };
}

export function templateUrl(meetingId: string): string {
  const base = (process.env["RECORDING_TEMPLATE_BASE_URL"] || TEMPLATE_BASE_DEFAULT).replace(/\/$/, "");
  return `${base}/recording/${meetingId}`;
}

/** Caminho do MP4 dentro do bucket. */
export function recordingPath(meetingId: string, now = Date.now()): string {
  return `${meetingId}/${now}.mp4`;
}

export type EgressRowStatus = "starting" | "active" | "ending" | "complete" | "failed";

/** Mapeia EgressStatus do LiveKit (enum numérico) → status do banco. */
export function mapEgressStatus(s: number): EgressRowStatus {
  // 0 STARTING, 1 ACTIVE, 2 ENDING, 3 COMPLETE, 4 FAILED, 5 ABORTED, 6 LIMIT_REACHED
  switch (s) {
    case 0:
      return "starting";
    case 1:
      return "active";
    case 2:
      return "ending";
    case 3:
      return "complete";
    default:
      return "failed";
  }
}

export interface EgressInfoLike {
  egressId: string;
  status: number;
  error?: string;
  startedAt?: bigint | number;
  endedAt?: bigint | number;
  fileResults?: { filename?: string; size?: bigint | number; duration?: bigint | number }[];
}

const nsToIso = (ns?: bigint | number) => (ns && Number(ns) > 0 ? new Date(Number(ns) / 1e6).toISOString() : null);

/** Patch de banco a partir do EgressInfo real (puro — testável). */
export function buildEgressPatch(info: EgressInfoLike, nowIso = new Date().toISOString()) {
  const status = mapEgressStatus(info.status);
  const file = info.fileResults?.[0];
  let durationSec = file?.duration ? Math.round(Number(file.duration) / 1e9) : null;
  const startedIso = nsToIso(info.startedAt);
  const endedIso = nsToIso(info.endedAt);
  if (durationSec == null && info.startedAt && info.endedAt && Number(info.endedAt) > Number(info.startedAt)) {
    durationSec = Math.round((Number(info.endedAt) - Number(info.startedAt)) / 1e9);
  }
  const patch: Record<string, unknown> = { status };
  if (startedIso) patch["started_at"] = startedIso;
  else if (status === "active") patch["started_at"] = nowIso;
  if (status === "complete" || status === "failed") patch["ended_at"] = endedIso ?? nowIso;
  if (status === "failed") patch["error"] = info.error || "egress failed";
  if (status === "complete") {
    if (file?.size) patch["file_size"] = Number(file.size);
    patch["duration_seconds"] = durationSec;
  }
  return { status, patch, durationSec, endedIso: (patch["ended_at"] as string | undefined) ?? null };
}

/** Atualiza meeting_egress (e o meeting ao concluir) a partir do estado real do Egress. */
export async function applyEgressInfo(info: EgressInfoLike): Promise<EgressRowStatus | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabaseAdmin as any;
  const { data: row } = await db
    .from("meeting_egress")
    .select("id, meeting_id, file_path, started_by, status")
    .eq("egress_id", info.egressId)
    .maybeSingle();
  if (!row) return null;
  if (row.status === "complete" || row.status === "failed") return row.status; // terminal
  const { status, patch, durationSec, endedIso } = buildEgressPatch(info);
  // Não regredir "ending" (stop já pedido) para "active" por evento atrasado.
  if (row.status === "ending" && (status === "active" || status === "starting")) delete patch["status"];
  await db.from("meeting_egress").update(patch).eq("id", row.id);
  if (status === "complete" && row.file_path) {
    await db
      .from("meetings")
      .update({
        recording_path: row.file_path,
        recording_duration_seconds: durationSec,
        recorded_by: row.started_by,
        recording_uploaded_at: endedIso ?? new Date().toISOString(),
      })
      .eq("id", row.meeting_id);
  }
  return status;
}

/** Consulta pontual do estado real no LiveKit e reconcilia o banco. Sem polling. */
export async function reconcileEgressState(
  egressId: string,
  fetchInfo?: (id: string) => Promise<EgressInfoLike | null>,
): Promise<EgressRowStatus | "unknown"> {
  const get =
    fetchInfo ??
    (async (id: string) => {
      const lk = readLiveKit();
      const sdk = await import("livekit-server-sdk");
      const list = await new sdk.EgressClient(lk.host, lk.apiKey, lk.apiSecret).listEgress({ egressId: id });
      return (list[0] as unknown as EgressInfoLike) ?? null;
    });
  const info = await get(egressId);
  if (!info) {
    console.warn("[egress-reconcile]", JSON.stringify({ egressId, result: "not_found" }));
    return "unknown";
  }
  const status = await applyEgressInfo(info);
  console.log("[egress-reconcile]", JSON.stringify({ egressId, livekit: mapEgressStatus(info.status), db: status }));
  return status ?? "unknown";
}
