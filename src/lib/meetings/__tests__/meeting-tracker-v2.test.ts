import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { MeetingTrackerV2, type MeetingRoomState } from "../meeting-tracker-v2";
import type { MediaContext } from "@/lib/rtc/media-context";

const P = (zoneId: string): MediaContext => ({ kind: "PRIVATE_ROOM", zoneId }) as MediaContext;
const LOBBY = { kind: "LOBBY" } as MediaContext;
const st = (
  status: MeetingRoomState["status"],
  connected: MediaContext | null,
): MeetingRoomState => ({
  status,
  connected,
});

function setup(opts: { joinFail?: boolean; leaveFail?: boolean } = {}) {
  const log: string[] = [];
  let n = 0;
  const onError = vi.fn();
  const t = new MeetingTrackerV2({
    join: async (z) => {
      log.push(`join:${z}`);
      if (opts.joinFail) throw new Error("rpc down");
      return `m${++n}-${z}`;
    },
    leave: async (id) => {
      log.push(`leave:${id}`);
      if (opts.leaveFail) throw new Error("rpc down");
    },
    onError,
    setTimeout: (fn: () => void) => {
      queueMicrotask(fn);
      return 0;
    },
    clearTimeout: () => {},
  });
  const run = async (s: MeetingRoomState | null) => {
    t.observe(s);
    await t.whenIdle();
  };
  return { t, log, run, onError };
}

describe("MeetingTrackerV2 (Etapa 13)", () => {
  it("1. zona geométrica com Room CONNECTING: zero join", async () => {
    const { log, run } = setup();
    await run(st("CONNECTING", null));
    await run(st("DISCONNECTED", null));
    expect(log).toEqual([]);
  });

  it("2-4. CONNECTED privado: exatamente um join, sem duplicar em rerender/eventos repetidos", async () => {
    const { log, run, t } = setup();
    const s = st("CONNECTED", P("sala-reuniao"));
    await run(s);
    await run(s);
    await run(st("CONNECTED", P("sala-reuniao")));
    t.observe(s);
    t.observe(s);
    await t.whenIdle();
    expect(log).toEqual(["join:sala-reuniao"]);
    expect(t.getMeetingId()).toBe("m1-sala-reuniao");
  });

  it("eventos concorrentes durante join em voo não duplicam", async () => {
    const { log, t } = setup();
    for (let i = 0; i < 5; i++) t.observe(st("CONNECTED", P("a")));
    await t.whenIdle();
    expect(log).toEqual(["join:a"]);
  });

  it("5. private → lobby: exatamente um leave", async () => {
    const { log, run } = setup();
    await run(st("CONNECTED", P("a")));
    await run(st("DISCONNECTING", P("a")));
    await run(st("CONNECTING", null));
    await run(st("CONNECTED", LOBBY));
    await run(st("CONNECTED", LOBBY));
    expect(log).toEqual(["join:a", "leave:m1-a"]);
  });

  it("6-7. A → B: leave A antes; join B só após B CONNECTED", async () => {
    const { log, run } = setup();
    await run(st("CONNECTED", P("a")));
    await run(st("DISCONNECTING", P("a")));
    await run(st("CONNECTING", null));
    expect(log).toEqual(["join:a", "leave:m1-a"]);
    await run(st("CONNECTED", P("b")));
    expect(log).toEqual(["join:a", "leave:m1-a", "join:b"]);
  });

  it("8-9. RECONNECTING não faz leave; RECONNECTED não faz novo join", async () => {
    const { log, run, t } = setup();
    await run(st("CONNECTED", P("a")));
    await run(st("RECONNECTING", P("a")));
    await run(st("CONNECTED", P("a")));
    expect(log).toEqual(["join:a"]);
    expect(t.getMeetingId()).toBe("m1-a");
  });

  it("RECONNECTING sem participação prévia não cria join", async () => {
    const { log, run } = setup();
    await run(st("RECONNECTING", P("a")));
    expect(log).toEqual([]);
  });

  it("10. disconnect terminal (ERROR/DISCONNECTED) faz leave", async () => {
    const { log, run } = setup();
    await run(st("CONNECTED", P("a")));
    await run(st("RECONNECTING", P("a")));
    await run(st("ERROR", null));
    await run(st("ERROR", null));
    expect(log).toEqual(["join:a", "leave:m1-a"]);
  });

  it("11. takeover (runtime desmontado → snapshot null) faz leave", async () => {
    const { log, run } = setup();
    await run(st("CONNECTED", P("a")));
    await run(null);
    expect(log).toEqual(["join:a", "leave:m1-a"]);
  });

  it("12. unmount: cleanup sem duplicação", async () => {
    const { log, run, t } = setup();
    await run(st("CONNECTED", P("a")));
    await t.dispose();
    await t.dispose();
    t.observe(st("CONNECTED", P("a")));
    await t.whenIdle();
    expect(log).toEqual(["join:a", "leave:m1-a"]);
  });

  it("unmount com join em voo: leave assim que o join resolve", async () => {
    const { log, t } = setup();
    t.observe(st("CONNECTED", P("a")));
    await t.dispose();
    expect(log).toEqual(["join:a", "leave:m1-a"]);
  });

  it("13. falha no join é só logada, retry limitado (1 + 3)", async () => {
    const { log, run, onError } = setup({ joinFail: true });
    await run(st("CONNECTED", P("a")));
    await run(st("CONNECTED", P("a")));
    await run(st("RECONNECTING", P("a")));
    expect(log).toEqual(["join:a", "join:a", "join:a", "join:a"]);
    expect(onError).toHaveBeenLastCalledWith("join", expect.any(Error), 4, true);
  });

  it("14. falha no leave é só logada e não impede o próximo join", async () => {
    const { log, run, onError } = setup({ leaveFail: true });
    await run(st("CONNECTED", P("a")));
    await run(st("CONNECTED", P("b")));
    expect(log).toEqual(["join:a", ...Array(4).fill("leave:m1-a"), "join:b"]);
    expect(onError).toHaveBeenLastCalledWith("leave", expect.any(Error), 4, true);
  });

  it("15-16. lobby/proximidade nunca cria meeting", async () => {
    const { log, run } = setup();
    await run(st("CONNECTING", LOBBY));
    await run(st("CONNECTED", LOBBY));
    await run(st("RECONNECTING", LOBBY));
    await run(st("CONNECTED", LOBBY));
    expect(log).toEqual([]);
  });

  it("17-18. workspace e common (ambos ZONE_ROOM) participam", async () => {
    const { log, run } = setup();
    await run(st("CONNECTED", P("atendente-1"))); // workspace
    await run(st("CONNECTED", P("descompressao"))); // common
    expect(log).toEqual(["join:atendente-1", "leave:m1-atendente-1", "join:descompressao"]);
  });

  it("19. entrada não depende de posição de outros usuários (API não recebe posições)", () => {
    const src = readFileSync("src/lib/meetings/meeting-tracker-v2.ts", "utf8");
    expect(src.replace(/^\s*\/\/.*$/gm, "")).not.toMatch(
      /desiredPeers|positions|presence\.|peerCount/,
    );
  });

  it("20. fachada mantém V1 legado e V2 escolhido pelo engine", () => {
    const src = readFileSync("src/lib/meetings/useMeetingTracker.ts", "utf8");
    expect(src).toMatch(/function useMeetingTrackerV1/);
    expect(src).toMatch(/ACTIVE_RTC_ENGINE === "v2" \? useMeetingTrackerV2 : useMeetingTrackerV1/);
  });

  it("tracker não importa nada que controle mídia", () => {
    const src = readFileSync("src/lib/meetings/meeting-tracker-v2.ts", "utf8");
    const imports = src.match(/^import .*$/gm) ?? [];
    expect(imports.every((l) => l.includes("import type"))).toBe(true);
  });

  describe("13B retry administrativo limitado", () => {
    function manual(joinResults: Array<"ok" | "fail">, leaveResults: Array<"ok" | "fail"> = []) {
      const log: string[] = [];
      const timers: Array<{ fn: () => void; ms: number; dead: boolean }> = [];
      const joinGates: Array<() => void> = [];
      let n = 0;
      let gateJoins = false;
      const t = new MeetingTrackerV2({
        join: async (z) => {
          log.push(`join:${z}`);
          if (gateJoins) await new Promise<void>((r) => joinGates.push(r));
          if ((joinResults.shift() ?? "ok") === "fail") throw new Error("transient");
          return `m${++n}-${z}`;
        },
        leave: async (id) => {
          log.push(`leave:${id}`);
          if ((leaveResults.shift() ?? "ok") === "fail") throw new Error("transient");
        },
        setTimeout: (fn, ms) => {
          const h = { fn, ms, dead: false };
          timers.push(h);
          return h;
        },
        clearTimeout: (h) => {
          (h as { dead: boolean }).dead = true;
        },
      });
      const flush = () => new Promise((r) => setTimeout(r, 0));
      const fire = async () => {
        const h = timers.find((x) => !x.dead);
        if (!h) return null;
        h.dead = true;
        h.fn();
        await flush();
        return h.ms;
      };
      const live = () => timers.filter((x) => !x.dead).map((x) => x.ms);
      return {
        t,
        log,
        flush,
        fire,
        live,
        gate: () => (gateJoins = true),
        release: async () => {
          joinGates.shift()?.();
          await flush();
        },
      };
    }

    it("1-2. primeiro join falha, segundo funciona; uma participação lógica", async () => {
      const m = manual(["fail", "ok"]);
      m.t.observe(st("CONNECTED", P("a")));
      await m.flush();
      expect(m.live()).toEqual([1000]);
      await m.fire();
      expect(m.log).toEqual(["join:a", "join:a"]);
      expect(m.t.getMeetingId()).toBe("m1-a");
      m.t.observe(st("CONNECTED", P("a")));
      await m.flush();
      expect(m.live()).toEqual([]);
      expect(m.log).toEqual(["join:a", "join:a"]);
    });

    it("3. usuário sai antes do retry: retry cancelado", async () => {
      const m = manual(["fail"]);
      m.t.observe(st("CONNECTED", P("a")));
      await m.flush();
      m.t.observe(st("CONNECTED", LOBBY));
      await m.t.whenIdle();
      expect(m.live()).toEqual([]);
      expect(m.log).toEqual(["join:a"]);
    });

    it("4. A → B antes do retry de A: nunca join tardio em A", async () => {
      const m = manual(["fail", "ok"]);
      m.t.observe(st("CONNECTED", P("a")));
      await m.flush();
      m.t.observe(st("CONNECTING", null));
      await m.flush();
      m.t.observe(st("CONNECTED", P("b")));
      await m.t.whenIdle();
      expect(m.log).toEqual(["join:a", "join:b"]);
      expect(m.live()).toEqual([]);
    });

    it("5-6. todas falham: backoff 1s/3s/8s, 4 tentativas, depois para", async () => {
      const m = manual(["fail", "fail", "fail", "fail", "fail"]);
      m.t.observe(st("CONNECTED", P("a")));
      await m.flush();
      const delays: Array<number | null> = [];
      for (let i = 0; i < 5; i++) delays.push(await m.fire());
      expect(delays).toEqual([1000, 3000, 8000, null, null]);
      expect(m.log.filter((l) => l === "join:a")).toHaveLength(4);
      m.t.observe(st("CONNECTED", P("a")));
      await m.flush();
      expect(m.live()).toEqual([]);
      expect(m.t.getMeetingId()).toBeNull();
    });

    it("7. unmount com join em andamento: join conclui e depois leave (sem órfã)", async () => {
      const m = manual(["ok"]);
      m.gate();
      m.t.observe(st("CONNECTED", P("a")));
      await m.flush();
      const done = m.t.dispose();
      await m.release();
      await done;
      expect(m.log).toEqual(["join:a", "leave:m1-a"]);
      expect(m.t.getMeetingId()).toBeNull();
    });

    it("leave com falha transitória: retry mesmo após unmount", async () => {
      const m = manual(["ok"], ["fail", "ok"]);
      m.t.observe(st("CONNECTED", P("a")));
      await m.flush();
      const done = m.t.dispose();
      await m.flush();
      expect(m.live()).toEqual([1000]);
      await m.fire();
      await done;
      expect(m.log).toEqual(["join:a", "leave:m1-a", "leave:m1-a"]);
    });

    it("8. RECONNECTING com participação registrada: nenhum retry/join", async () => {
      const m = manual(["ok"]);
      m.t.observe(st("CONNECTED", P("a")));
      await m.flush();
      m.t.observe(st("RECONNECTING", P("a")));
      m.t.observe(st("CONNECTED", P("a")));
      await m.flush();
      expect(m.log).toEqual(["join:a"]);
      expect(m.live()).toEqual([]);
    });

    it("RECONNECTING durante espera do retry suspende; RECONNECTED retoma sem exceder limite", async () => {
      const m = manual(["fail", "ok"]);
      m.t.observe(st("CONNECTED", P("a")));
      await m.flush();
      m.t.observe(st("RECONNECTING", P("a")));
      await m.flush();
      expect(m.live()).toEqual([]);
      m.t.observe(st("CONNECTED", P("a")));
      await m.flush();
      expect(m.live()).toEqual([1000]);
      await m.fire();
      expect(m.log).toEqual(["join:a", "join:a"]);
    });
  });
});
