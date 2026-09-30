import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { mapEgressStatus, readS3Config, recordingPath, templateUrl } from "@/lib/meetings/egress.server";

const KEYS = ["RECORDING_S3_ENDPOINT", "RECORDING_S3_REGION", "RECORDING_S3_ACCESS_KEY_ID", "RECORDING_S3_SECRET_ACCESS_KEY", "SUPABASE_URL"];
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
afterEach(() => KEYS.forEach((k) => (saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k]))));

describe("Etapa 14D — gravação server-side", () => {
  it("sem secrets S3 → lista só os nomes faltantes", () => {
    KEYS.forEach((k) => delete process.env[k]);
    process.env["SUPABASE_URL"] = "https://x.supabase.co";
    const r = readS3Config();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.missing).toEqual(["RECORDING_S3_ENDPOINT", "RECORDING_S3_REGION", "RECORDING_S3_ACCESS_KEY_ID", "RECORDING_S3_SECRET_ACCESS_KEY"]);
  });

  it("R2: endpoint customizado, region auto, bucket meeting-recordings", () => {
    process.env["RECORDING_S3_ENDPOINT"] = "https://acc.r2.cloudflarestorage.com";
    process.env["RECORDING_S3_REGION"] = "auto";
    process.env["RECORDING_S3_ACCESS_KEY_ID"] = "a";
    process.env["RECORDING_S3_SECRET_ACCESS_KEY"] = "b";
    const r = readS3Config();
    expect(r.ok && r.cfg).toMatchObject({ endpoint: "https://acc.r2.cloudflarestorage.com", bucket: "meeting-recordings" });
  });

  it("status do Egress mapeado; abortado/limite = failed", () => {
    expect([0, 1, 2, 3, 4, 5, 6].map(mapEgressStatus)).toEqual(["starting", "active", "ending", "complete", "failed", "failed", "failed"]);
  });

  it("caminho MP4 e template por reunião", () => {
    expect(recordingPath("m1", 5)).toBe("m1/5.mp4");
    expect(templateUrl("m1")).toMatch(/\/recording\/m1$/);
  });

  it("caminho V2 e template não usam getDisplayMedia nem MediaRecorder", () => {
    for (const f of ["src/lib/meetings/useServerRecorder.ts", "src/routes/recording.$meetingId.tsx", "src/lib/meetings/egress.functions.ts"]) {
      const src = readFileSync(f, "utf8");
      expect(src).not.toMatch(/getDisplayMedia|new MediaRecorder/);
    }
  });

  it("template é subscribe-only e sem sessão/presence", () => {
    const src = readFileSync("src/routes/recording.$meetingId.tsx", "utf8");
    expect(src).not.toMatch(/publishTrack|setMicrophoneEnabled|setCameraEnabled|claim_office_session|\.track\(/);
    expect(src).toMatch(/START_RECORDING/);
  });

  it("secrets nunca vão ao browser: módulos cliente não leem process.env", () => {
    for (const f of ["src/lib/meetings/useServerRecorder.ts", "src/routes/recording.$meetingId.tsx"]) {
      expect(readFileSync(f, "utf8")).not.toMatch(/process\.env|RECORDING_S3|LIVEKIT_API/);
    }
  });
});
