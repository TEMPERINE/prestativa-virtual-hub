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
  const apiKey = process.env["LIVEKIT_API_KEY"];
  const apiSecret = process.env["LIVEKIT_API_SECRET"];
  const url = process.env["LIVEKIT_URL"];
  if (!apiKey || !apiSecret || !url) throw new Error("LiveKit não configurado");
  // Clientes REST usam https:// em vez de wss://
  const host = url.replace(/^wss:/, "https:").replace(/^ws:/, "http:");
  return { apiKey, apiSecret, host };
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

interface EgressInfoLike {
  egressId: string;
  status: number;
  error?: string;
  fileResults?: { filename?: string; size?: bigint | number; duration?: bigint | number }[];
}

/** Atualiza meeting_egress (e o meeting ao concluir) a partir do estado real do Egress. */
export async function applyEgressInfo(info: EgressInfoLike): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const status = mapEgressStatus(info.status);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabaseAdmin as any;
  const { data: row } = await db
    .from("meeting_egress")
    .select("id, meeting_id, file_path, started_by, status")
    .eq("egress_id", info.egressId)
    .maybeSingle();
  if (!row) return;
  if (row.status === "complete" || row.status === "failed") return; // terminal
  const file = info.fileResults?.[0];
  const durationSec = file?.duration ? Math.round(Number(file.duration) / 1e9) : null;
  const patch: Record<string, unknown> = { status };
  if (status === "active") patch["started_at"] = new Date().toISOString();
  if (status === "complete" || status === "failed") patch["ended_at"] = new Date().toISOString();
  if (status === "failed") patch["error"] = info.error || "egress failed";
  if (status === "complete") {
    patch["file_size"] = file?.size ? Number(file.size) : null;
    patch["duration_seconds"] = durationSec;
  }
  await db.from("meeting_egress").update(patch).eq("id", row.id);
  if (status === "complete" && row.file_path) {
    await db
      .from("meetings")
      .update({
        recording_path: row.file_path,
        recording_duration_seconds: durationSec,
        recorded_by: row.started_by,
        recording_uploaded_at: new Date().toISOString(),
      })
      .eq("id", row.meeting_id);
  }
}
