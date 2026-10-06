import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { AccessToken, WebhookReceiver } from "livekit-server-sdk";
import { buildEgressPatch, extractWebhookToken } from "@/lib/meetings/egress.server";

const KEY = "APItest";
const SECRET = "secret_test_value_123456789012345";

async function sign(body: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
  const sha = btoa(String.fromCharCode(...new Uint8Array(buf)));
  const t = new AccessToken(KEY, SECRET);
  t.sha256 = sha;
  return t.toJwt();
}
const body = '{"event":"egress_ended","egressInfo":{"egressId":"EG_x","status":"EGRESS_COMPLETE"}}';

describe("webhook LiveKit — assinatura sobre corpo RAW", () => {
  it("assinatura válida (Authorization puro, Bearer ou Authorize) é aceita", async () => {
    const jwt = await sign(body);
    for (const h of [{ authorization: jwt }, { authorization: `Bearer ${jwt}` }, { authorize: jwt }]) {
      const { token } = extractWebhookToken(new Headers(h));
      const ev = await new WebhookReceiver(KEY, SECRET).receive(body, token);
      expect(ev.event).toBe("egress_ended");
      expect(ev.egressInfo?.egressId).toBe("EG_x");
    }
  });

  it("assinatura inválida ou corpo alterado → rejeita", async () => {
    const jwt = await sign(body);
    await expect(new WebhookReceiver(KEY, "outro").receive(body, jwt)).rejects.toThrow();
    const reformatted = JSON.stringify(JSON.parse(body), null, 1);
    await expect(new WebhookReceiver(KEY, SECRET).receive(reformatted, jwt)).rejects.toThrow(/sha256/);
  });

  it("rota lê request.text() e não faz parse antes de validar", () => {
    const src = readFileSync("src/routes/api/public/livekit-egress.ts", "utf8");
    expect(src).toMatch(/request\.text\(\)/);
    expect(src).not.toMatch(/request\.json\(\)|JSON\.stringify\(\s*event/);
    expect(src).toMatch(/status: 401/);
    expect(src).not.toMatch(/apiSecret\b[^,)]*\)\s*}\)?\s*;?\s*\/\/ log|LIVEKIT_API_SECRET/);
  });
});

describe("reconciliação a partir do EgressInfo real", () => {
  it("COMPLETE: status, ended_at real, duração e tamanho", () => {
    const r = buildEgressPatch({
      egressId: "EG",
      status: 3,
      startedAt: 1791313146536872000n,
      endedAt: 1791313282988439000n,
      fileResults: [{ size: 22847426n }],
    });
    expect(r.status).toBe("complete");
    expect(r.patch["ended_at"]).toBe(new Date(1791313282988).toISOString());
    expect(r.patch["duration_seconds"]).toBe(136);
    expect(r.patch["file_size"]).toBe(22847426);
  });

  it("FAILED/ABORTED → failed com erro", () => {
    for (const s of [4, 5, 6]) {
      const r = buildEgressPatch({ egressId: "EG", status: s, error: "boom" });
      expect(r.status).toBe("failed");
      expect(r.patch["error"]).toBe("boom");
      expect(r.patch["ended_at"]).toBeTruthy();
    }
  });
});

describe("stopServerRecording sem catch silencioso", () => {
  const src = readFileSync("src/lib/meetings/egress.functions.ts", "utf8");
  it("erro de stop gera log e reconcilia com estado real", () => {
    expect(src).not.toMatch(/webhook confirma o estado final/);
    expect(src).toMatch(/\[egress-stop\]/);
    expect(src).toMatch(/reconcileEgressState\(row\.egress_id\)/);
    expect(src).toMatch(/EGRESS_STOP_FAILED/);
  });
  it("RTC intocado: módulos de gravação não importam runtime RTC", () => {
    for (const f of ["src/lib/meetings/egress.server.ts", "src/lib/meetings/egress.functions.ts"]) {
      expect(readFileSync(f, "utf8")).not.toMatch(/rtc-v2-runtime|livekit-room-manager|rtc-demand-controller/);
    }
  });
});
