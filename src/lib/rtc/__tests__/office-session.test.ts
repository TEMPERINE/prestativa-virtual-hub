import { describe, expect, it, vi } from "vitest";
import {
  OfficeSessionController,
  type CurrentSessionRow,
  type OfficeSessionBackend,
  type TakeoverChannelHandlers,
} from "@/lib/rtc/office-session";

/** Backend em memória que reproduz a semântica das RPCs da Etapa 2. */
function makeBackend() {
  const db = { row: null as (CurrentSessionRow & { workspaceId: string }) | null };
  const channels: { handlers: TakeoverChannelHandlers; closed: boolean; sent: unknown[] }[] = [];
  let claimError: Error | null = null;
  let releaseError: Error | null = null;
  const backend: OfficeSessionBackend = {
    claim: vi.fn(async (sessionId: string, workspaceId: string) => {
      if (claimError) throw claimError;
      const generation = (db.row?.generation ?? 0) + 1;
      db.row = { sessionId, generation, active: true, workspaceId };
      return { sessionId, generation };
    }),
    release: vi.fn(async (sessionId: string, generation: number) => {
      if (releaseError) throw releaseError;
      if (
        db.row &&
        db.row.sessionId === sessionId &&
        db.row.generation === generation &&
        db.row.active
      ) {
        db.row.active = false;
        return true;
      }
      return false;
    }),
    fetchCurrent: vi.fn(async () => (db.row ? { ...db.row } : null)),
    openTakeoverChannel: vi.fn((_userId: string, handlers: TakeoverChannelHandlers) => {
      const ch = { handlers, closed: false, sent: [] as unknown[] };
      channels.push(ch);
      return {
        broadcastReplaced: async (ev: unknown) => {
          ch.sent.push(ev);
        },
        unsubscribe: async () => {
          ch.closed = true;
        },
      };
    }),
  };
  return {
    backend,
    db,
    channels,
    failClaim: (e: Error) => (claimError = e),
    failRelease: (e: Error) => (releaseError = e),
  };
}

let n = 0;
const ids = () => `sess-${++n}`;

describe("OfficeSessionController", () => {
  it("1+2. claim bem-sucedido -> ACTIVE e guarda generation do servidor", async () => {
    const b = makeBackend();
    b.db.row = { sessionId: "old", generation: 41, active: false, workspaceId: "ws" };
    const c = new OfficeSessionController(b.backend, ids);
    const s = await c.claim("u1", "ws");
    expect(s.status).toBe("ACTIVE");
    expect(s.generation).toBe(42);
    expect(s.workspaceId).toBe("ws");
    expect(b.channels[0].sent).toEqual([{ sessionId: s.sessionId, generation: 42 }]);
  });

  it("3. SESSION_REPLACED com generation maior -> REPLACED", async () => {
    const b = makeBackend();
    const c = new OfficeSessionController(b.backend, ids);
    await c.claim("u1", "ws");
    b.channels[0].handlers.onReplaced({ sessionId: "other", generation: 2 });
    expect(c.getState().status).toBe("REPLACED");
  });

  it("4. generation igual é ignorada (mesmo com sessionId diferente)", async () => {
    const b = makeBackend();
    const c = new OfficeSessionController(b.backend, ids);
    await c.claim("u1", "ws");
    b.channels[0].handlers.onReplaced({ sessionId: "other", generation: 1 });
    expect(c.getState().status).toBe("ACTIVE");
  });

  it("5. generation menor é ignorada", async () => {
    const b = makeBackend();
    b.db.row = { sessionId: "x", generation: 9, active: true, workspaceId: "ws" };
    const c = new OfficeSessionController(b.backend, ids);
    await c.claim("u1", "ws");
    b.channels[0].handlers.onReplaced({ sessionId: "x", generation: 3 });
    expect(c.getState().status).toBe("ACTIVE");
  });

  it("6. duas claims consecutivas: a sessão antiga cai, a nova fica com a maior generation", async () => {
    const b = makeBackend();
    const a = new OfficeSessionController(b.backend, ids);
    const bb = new OfficeSessionController(b.backend, ids);
    await a.claim("u1", "ws");
    await bb.claim("u1", "ws");
    // entrega o broadcast da sessão nova ao canal da antiga
    b.channels[0].handlers.onReplaced(b.channels[1].sent[0] as never);
    expect(a.getState().status).toBe("REPLACED");
    expect(bb.getState()).toMatchObject({ status: "ACTIVE", generation: 2 });
  });

  it("7. reconexão detecta perda de ownership sem receber SESSION_REPLACED", async () => {
    const b = makeBackend();
    const c = new OfficeSessionController(b.backend, ids);
    await c.claim("u1", "ws");
    b.db.row = { sessionId: "device-2", generation: 2, active: true, workspaceId: "ws" };
    b.channels[0].handlers.onSubscribed(false); // primeira conexão: sem revalidar
    expect(b.backend.fetchCurrent).not.toHaveBeenCalled();
    b.channels[0].handlers.onSubscribed(true); // reconexão
    await vi.waitFor(() => expect(c.getState().status).toBe("REPLACED"));
  });

  it("7b. reconexão mantém ACTIVE quando ainda é a dona", async () => {
    const b = makeBackend();
    const c = new OfficeSessionController(b.backend, ids);
    await c.claim("u1", "ws");
    expect((await c.revalidate()).status).toBe("ACTIVE");
  });

  it("8. release usa exatamente sessionId + generation atuais e marca active=false", async () => {
    const b = makeBackend();
    const c = new OfficeSessionController(b.backend, ids);
    const s = await c.claim("u1", "ws");
    await c.release();
    expect(b.backend.release).toHaveBeenCalledWith(s.sessionId, s.generation);
    expect(b.db.row?.active).toBe(false);
    expect(b.db.row?.generation).toBe(1);
    expect(c.getState().status).toBe("IDLE");
  });

  it("9. falha de release não reativa sessão substituída", async () => {
    const b = makeBackend();
    const c = new OfficeSessionController(b.backend, ids);
    await c.claim("u1", "ws");
    b.channels[0].handlers.onReplaced({ sessionId: "new", generation: 5 });
    b.failRelease(new Error("network"));
    await c.release();
    expect(c.getState().status).toBe("REPLACED");
    expect(b.backend.release).not.toHaveBeenCalled();
  });

  it("9b. release com erro de rede numa sessão ativa finaliza localmente", async () => {
    const b = makeBackend();
    const c = new OfficeSessionController(b.backend, ids);
    await c.claim("u1", "ws");
    b.failRelease(new Error("network"));
    await expect(c.release()).resolves.toBeUndefined();
    expect(c.getState().status).toBe("IDLE");
  });

  it("10. erro de claim -> ERROR", async () => {
    const b = makeBackend();
    b.failClaim(new Error("not a workspace member"));
    const c = new OfficeSessionController(b.backend, ids);
    const s = await c.claim("u1", "ws");
    expect(s.status).toBe("ERROR");
    expect(s.error).toContain("not a workspace member");
    expect(b.backend.openTakeoverChannel).not.toHaveBeenCalled();
  });

  it("11. cleanup remove a subscription do canal", async () => {
    const b = makeBackend();
    const c = new OfficeSessionController(b.backend, ids);
    await c.claim("u1", "ws");
    await c.dispose();
    expect(b.channels[0].closed).toBe(true);
  });

  it("gera sessionId novo a cada claim", async () => {
    const b = makeBackend();
    const c = new OfficeSessionController(b.backend, ids);
    const s1 = (await c.claim("u1", "ws")).sessionId;
    const s2 = (await c.claim("u1", "ws")).sessionId;
    expect(s1).not.toBe(s2);
    expect(b.channels[0].closed).toBe(true);
  });
});
