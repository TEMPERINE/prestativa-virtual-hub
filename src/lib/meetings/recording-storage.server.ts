/**
 * Abstração de armazenamento das gravações (somente servidor).
 *  - "cloud": gravações antigas V1 (WebM) no storage do Lovable Cloud.
 *  - "s3":    gravações V2/Egress (MP4) em storage S3-compatible externo (ex.: Cloudflare R2).
 * Credenciais S3 nunca saem do servidor; o navegador só recebe URL temporária.
 */
import { AwsClient } from "aws4fetch";
import { readS3Config, type S3Config } from "./egress.server";

export type RecordingBackend = "cloud" | "s3";
export const CLOUD_BUCKET = "meeting-recordings";
export const SIGNED_URL_TTL_SECONDS = 60 * 60;

/** Backend da gravação: S3 só quando há um Egress concluído com esse mesmo caminho. */
export async function resolveRecordingBackend(meetingId: string, path: string): Promise<RecordingBackend> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabaseAdmin as any)
    .from("meeting_egress")
    .select("id")
    .eq("meeting_id", meetingId)
    .eq("file_path", path)
    .eq("status", "complete")
    .limit(1);
  return data && data.length > 0 ? "s3" : "cloud";
}

function s3Client(cfg: S3Config) {
  return new AwsClient({
    accessKeyId: cfg.accessKey,
    secretAccessKey: cfg.secret,
    region: cfg.region,
    service: "s3",
  });
}

export function s3ObjectUrl(cfg: S3Config, key: string): string {
  const base = cfg.endpoint.replace(/\/$/, "");
  const safeKey = key.split("/").map(encodeURIComponent).join("/");
  return `${base}/${encodeURIComponent(cfg.bucket)}/${safeKey}`; // path-style
}

export async function presignS3Get(cfg: S3Config, key: string, ttl = SIGNED_URL_TTL_SECONDS): Promise<string> {
  const url = new URL(s3ObjectUrl(cfg, key));
  url.searchParams.set("X-Amz-Expires", String(ttl));
  const signed = await s3Client(cfg).sign(url.toString(), { method: "GET", aws: { signQuery: true } });
  return signed.url;
}

/** URL temporária para reprodução. */
export async function getRecordingSignedUrl(backend: RecordingBackend, path: string): Promise<string> {
  if (backend === "s3") {
    const s3 = readS3Config();
    if (!s3.ok) throw new Error("STORAGE_NOT_CONFIGURED");
    return presignS3Get(s3.cfg, path);
  }
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.storage.from(CLOUD_BUCKET).createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (error || !data?.signedUrl) throw new Error("SIGN_FAILED");
  return data.signedUrl;
}

/** Baixa a gravação no servidor (transcrição/resumo). */
export async function downloadRecording(
  backend: RecordingBackend,
  path: string,
): Promise<{ bytes: ArrayBuffer; mime: string }> {
  if (backend === "s3") {
    const s3 = readS3Config();
    if (!s3.ok) throw new Error("STORAGE_NOT_CONFIGURED");
    const res = await s3Client(s3.cfg).fetch(s3ObjectUrl(s3.cfg, path), { method: "GET" });
    if (!res.ok) throw new Error(`S3 download failed [${res.status}]`);
    return { bytes: await res.arrayBuffer(), mime: res.headers.get("content-type") || "video/mp4" };
  }
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.storage.from(CLOUD_BUCKET).download(path);
  if (error || !data) throw new Error("CLOUD_DOWNLOAD_FAILED");
  return { bytes: await data.arrayBuffer(), mime: data.type || "video/webm" };
}

/**
 * Exclui definitivamente um objeto do S3/R2 e confirma via HEAD (404 = removido).
 * Lança erro se a exclusão não puder ser confirmada.
 */
export async function deleteS3ObjectConfirmed(key: string): Promise<void> {
  const s3 = readS3Config();
  if (!s3.ok) throw new Error("STORAGE_NOT_CONFIGURED");
  const client = s3Client(s3.cfg);
  const url = s3ObjectUrl(s3.cfg, key);
  const del = await client.fetch(url, { method: "DELETE" });
  if (!del.ok && del.status !== 404) {
    throw new Error(`S3 delete failed [${del.status}]: ${(await del.text()).slice(0, 300)}`);
  }
  const head = await client.fetch(url, { method: "HEAD" });
  if (head.status !== 404) throw new Error(`S3 delete not confirmed [HEAD ${head.status}]`);
}

/** Exclui um arquivo do storage do Lovable Cloud (gravações V1 WebM). */
export async function deleteCloudObject(path: string): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error } = await supabaseAdmin.storage.from(CLOUD_BUCKET).remove([path]);
  if (error) throw new Error(`Cloud delete failed: ${error.message}`);
}
