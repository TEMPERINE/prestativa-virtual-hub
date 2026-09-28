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

  it("13. falha no join é só logada, sem retry em loop", async () => {
    const { log, run, onError } = setup({ joinFail: true });
    await run(st("CONNECTED", P("a")));
    await run(st("CONNECTED", P("a")));
    await run(st("RECONNECTING", P("a")));
    expect(log).toEqual(["join:a"]);
    expect(onError).toHaveBeenCalledWith("join", expect.any(Error));
  });

  it("14. falha no leave é só logada e não impede o próximo join", async () => {
    const { log, run, onError } = setup({ leaveFail: true });
    await run(st("CONNECTED", P("a")));
    await run(st("CONNECTED", P("b")));
    expect(log).toEqual(["join:a", "leave:m1-a", "join:b"]);
    expect(onError).toHaveBeenCalledWith("leave", expect.any(Error));
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
    expect(src.replace(/^\s*\/\/.*$/gm, "")).not.toMatch(/desiredPeers|positions|presence\.|peerCount/);
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
});
