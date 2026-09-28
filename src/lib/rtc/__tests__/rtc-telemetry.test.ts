import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  RtcTelemetry,
  TELEMETRY_BATCH_SIZE,
  TELEMETRY_FLUSH_MS,
  TELEMETRY_MAX_BUFFERED,
  sanitizeMetadata,
  type RtcEventRow,
  type RtcTelemetryEventType,
  type TelemetryAdapter,
} from "@/lib/rtc/rtc-telemetry";

const session = { workspaceId: "w1", sessionId: "s1", generation: 2 };
const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTYifQ.abcDEFghiJKL";

function fakeAdapter(opts: { fail?: boolean; delay?: number } = {}) {
  const rows: RtcEventRow[] = [];
  let calls = 0;
  const state = { fail: !!opts.fail };
  const adapter: TelemetryAdapter = {
    async insertEvents(batch) {
      calls++;
      if (opts.delay) await new Promise((r) => setTimeout(r, opts.delay));
      if (state.fail) throw new Error("db down");
      rows.push(...batch);
    },
  };
  return { adapter, rows, state, calls: () => calls };
}

function mk(a = fakeAdapter()) {
  return { t: new RtcTelemetry({ adapter: a.adapter, session }), a };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("RtcTelemetry", () => {
  it("1. record não bloqueia aguardando banco", () => {
    const { t, a } = mk(fakeAdapter({ delay: 60_000 }));
    const r = t.record("MIC_ON");
    expect(r).toBeUndefined();
    expect(a.calls()).toBe(0);
    expect(t.diagnostics.buffered).toBe(1);
  });

  it("2/18. eventSeq crescente com sessão/generation associadas", async () => {
    const { t, a } = mk();
    t.record("MIC_ON");
    t.record("MIC_OFF");
    t.record("CAM_ON");
    await t.dispose();
    expect(a.rows.map((r) => r.details.eventSeq)).toEqual([1, 2, 3]);
    for (const r of a.rows) expect(r).toMatchObject({ session_id: "s1", generation: 2, workspace_id: "w1" });
  });

  it("3. batch enviado ao atingir o limite", async () => {
    const { t, a } = mk();
    for (let i = 0; i < TELEMETRY_BATCH_SIZE; i++) t.record("MIC_ON");
    await vi.advanceTimersByTimeAsync(0);
    expect(a.rows).toHaveLength(TELEMETRY_BATCH_SIZE);
  });

  it("4. batch enviado pelo timer", async () => {
    const { t, a } = mk();
    t.record("MIC_ON");
    await vi.advanceTimersByTimeAsync(TELEMETRY_FLUSH_MS - 1);
    expect(a.rows).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(a.rows).toHaveLength(1);
  });

  it("5/24. dispose faz flush final e cancela timers", async () => {
    const { t, a } = mk();
    t.record("CAM_ON");
    await t.dispose();
    expect(a.rows).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
    t.record("CAM_OFF");
    expect(t.diagnostics.buffered).toBe(0);
  });

  it("6/7. falha de insert não derruba e incrementa contador; retry com backoff", async () => {
    const f = fakeAdapter({ fail: true });
    const { t } = mk(f);
    t.record("MIC_ON");
    await expect(vi.advanceTimersByTimeAsync(TELEMETRY_FLUSH_MS)).resolves.not.toThrow();
    expect(t.diagnostics.failures).toBe(1);
    expect(t.diagnostics.lastError).toBe("db down");
    expect(t.diagnostics.buffered).toBe(1);
    // backoff: próxima tentativa só após 4 s
    await vi.advanceTimersByTimeAsync(TELEMETRY_FLUSH_MS * 2 - 1);
    expect(f.calls()).toBe(1);
    f.state.fail = false;
    await vi.advanceTimersByTimeAsync(1);
    expect(f.rows).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(f.calls()).toBe(2); // sem retry infinito após sucesso
  });

  it("retry nunca fica agressivo: no máximo ~1 tentativa a cada 30 s", async () => {
    const f = fakeAdapter({ fail: true });
    const { t } = mk(f);
    t.record("MIC_ON");
    await vi.advanceTimersByTimeAsync(300_000);
    expect(f.calls()).toBeLessThanOrEqual(14);
    await t.dispose();
  });

  it("8/9/10. fila limitada, descarta antigos e conta droppedEvents", async () => {
    const f = fakeAdapter({ fail: true });
    const { t } = mk(f);
    for (let i = 0; i < TELEMETRY_MAX_BUFFERED + 25; i++) t.record("MIC_ON");
    expect(t.diagnostics.buffered).toBeLessThanOrEqual(TELEMETRY_MAX_BUFFERED);
    expect(t.diagnostics.droppedEvents).toBeGreaterThanOrEqual(15);
    f.state.fail = false;
    await t.dispose();
    const seqs = f.rows.map((r) => r.details.eventSeq as number);
    expect(Math.min(...seqs)).toBeGreaterThan(1); // os mais antigos saíram
    expect(Math.max(...seqs)).toBe(TELEMETRY_MAX_BUFFERED + 25);
  });

  it("11-15. segurança: token, JWT, secret, SDP, ICE, IP, e-mail e Error cru", async () => {
    const { t, a } = mk();
    const err = Object.assign(new Error(`failed with token ${JWT}`), {
      code: "E_SIGNAL",
      stack: "secret stack",
      response: { apiSecret: "shhh" },
    });
    t.record("ROOM_CONNECT_FAILED", {
      error: err,
      roomName: "prestativa-office:w1:lobby",
      metadata: {
        token: JWT,
        apiSecret: "supersecretvalue",
        reason: JWT,
        status: "v=0\r\no=- 4611 2 IN IP4 127.0.0.1\r\nm=audio 9",
        channel: "candidate:842163049 1 udp 1677729535 10.0.0.1 54400 typ srflx",
        quality: "user@example.com",
        attempt: 3,
        engine: "x".repeat(5000),
        nested: { a: 1 },
      } as Record<string, unknown>,
    });
    await t.dispose();
    const dump = JSON.stringify(a.rows);
    for (const bad of [JWT, "supersecretvalue", "shhh", "secret stack", "candidate:", "10.0.0.1", "127.0.0.1", "v=0", "user@example.com", "nested"]) {
      expect(dump).not.toContain(bad);
    }
    const d = a.rows[0].details;
    expect(d).not.toHaveProperty("token");
    expect(d).not.toHaveProperty("apiSecret");
    expect(d.reason).toBe("[redacted]");
    expect(d.attempt).toBe(3);
    expect((d.engine as string).length).toBeLessThanOrEqual(200);
    expect(d.errorCode).toBe("E_SIGNAL");
    expect(d.errorMessage).toBe("[redacted]");
    expect(a.rows[0].room_name).toBe("prestativa-office:w1:lobby");
  });

  it("16. metadata válida permanece", () => {
    expect(sanitizeMetadata({ reason: "user_left", attempt: 2, participantCount: 4, trackKind: "audio" })).toEqual({
      reason: "user_left",
      attempt: 2,
      participantCount: 4,
      trackKind: "audio",
    });
  });

  it("17. usuário não escolhe userId", async () => {
    const { t, a } = mk();
    t.record("MIC_ON", { metadata: { userId: "outro", user_id: "outro" } } as never);
    await t.dispose();
    expect(a.rows[0]).not.toHaveProperty("user_id");
    expect(JSON.stringify(a.rows)).not.toContain("outro");
  });

  it("19. duas sessões possuem sequências independentes", async () => {
    const { t, a } = mk();
    t.record("MIC_ON");
    t.record("MIC_OFF");
    t.setSession({ workspaceId: "w1", sessionId: "s2", generation: 3 });
    t.record("SESSION_CLAIMED");
    await t.dispose();
    expect(a.rows.map((r) => [r.session_id, r.details.eventSeq])).toEqual([
      ["s1", 1],
      ["s1", 2],
      ["s2", 1],
    ]);
  });

  it("20. repetição real é registrada; re-render com dedupeKey não", async () => {
    const { t, a } = mk();
    t.record("MIC_ON");
    t.record("MIC_ON");
    t.record("CONTEXT_CHANGED", { dedupeKey: "LOBBY#1" });
    t.record("CONTEXT_CHANGED", { dedupeKey: "LOBBY#1" });
    t.record("CONTEXT_CHANGED", { dedupeKey: "ZONE_A#2" });
    await t.dispose();
    expect(a.rows.map((r) => r.event_type)).toEqual(["MIC_ON", "MIC_ON", "CONTEXT_CHANGED", "CONTEXT_CHANGED"]);
  });

  it("21. movimento normal não é aceito", async () => {
    const { t, a } = mk();
    for (const m of ["MOTION_START", "MOTION_CHANGE", "POSITION_SYNC", "POSITION_SNAPSHOT"]) {
      t.record(m as RtcTelemetryEventType);
    }
    await t.dispose();
    expect(a.rows).toHaveLength(0);
    expect(t.diagnostics.rejectedEvents).toBe(4);
  });

  it("22/23. falha não altera RoomManager nem LocalMedia fakes", async () => {
    const f = fakeAdapter({ fail: true });
    const { t } = mk(f);
    const room = { state: "CONNECTED", connect: vi.fn() };
    const media = { mic: true, cam: false };
    t.record("ROOM_SIGNAL_CONNECTED", { connectionState: room.state });
    t.record("MIC_ON");
    await vi.advanceTimersByTimeAsync(10_000);
    await t.dispose();
    expect(room).toMatchObject({ state: "CONNECTED" });
    expect(room.connect).not.toHaveBeenCalled();
    expect(media).toEqual({ mic: true, cam: false });
  });

  it("adapter que lança síncronamente não derruba", async () => {
    const t = new RtcTelemetry({
      adapter: {
        insertEvents: () => {
          throw new Error("sync boom");
        },
      },
      session,
    });
    t.record("MIC_ON");
    await vi.advanceTimersByTimeAsync(TELEMETRY_FLUSH_MS);
    expect(t.diagnostics.failures).toBe(1);
    await t.dispose();
  });

  it("25. flush atrasado resolvido após dispose não recria timer", async () => {
    const f = fakeAdapter({ delay: 5000, fail: true });
    const { t } = mk(f);
    t.record("MIC_ON");
    await vi.advanceTimersByTimeAsync(TELEMETRY_FLUSH_MS); // flush em voo
    const d = t.dispose();
    await vi.advanceTimersByTimeAsync(20_000);
    await d;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("volume: sessão longa", async () => {
    const { t, a } = mk();
    const moved: number[] = [];
    for (let i = 0; i < 100; i++) moved.push(i); // posição não passa pela telemetria
    for (let i = 0; i < 10; i++) {
      t.record("CONTEXT_CHANGE_REQUESTED", { context: i % 2 ? "LOBBY" : "PRIVATE_ROOM" });
      t.record("CONTEXT_CHANGED", { context: i % 2 ? "LOBBY" : "PRIVATE_ROOM", dedupeKey: `c${i}` });
    }
    for (let i = 0; i < 5; i++) {
      t.record("ROOM_RECONNECTING");
      t.record("ROOM_RECONNECTED");
    }
    t.record("MIC_ON");
    t.record("MIC_OFF");
    t.record("CAM_ON");
    t.record("CAM_OFF");
    await t.dispose();
    console.info("[telemetry volume] persisted:", a.rows.length);
    expect(moved).toHaveLength(100);
    expect(a.rows).toHaveLength(34);
    expect(t.diagnostics.droppedEvents).toBe(0);
  });
});
