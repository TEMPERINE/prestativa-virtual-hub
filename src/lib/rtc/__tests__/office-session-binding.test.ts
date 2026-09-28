import { describe, expect, it, vi } from "vitest";
import type {
  CurrentSessionRow,
  OfficeSessionBackend,
  TakeoverChannelHandlers,
} from "@/lib/rtc/office-session";
import {
  OfficeSessionBinder,
  REVALIDATE_INTERVAL_MS,
  officeGateView,
  type BindingEnv,
} from "@/lib/rtc/office-session-binding";

/** "Banco" compartilhado entre dispositivos, com a semântica das RPCs da Etapa 2. */
function makeServer() {
  const db = { row: null as CurrentSessionRow | null, claims: 0 };
  const channels: {
    handlers: TakeoverChannelHandlers;
    closed: boolean;
    deliver: boolean;
  }[] = [];
  let failNextClaim = false;
  const makeBackend = (): OfficeSessionBackend => ({
    claim: async (sessionId) => {
      if (failNextClaim) {
        failNextClaim = false;
        throw new Error("network");
      }
      db.claims++;
      const generation = (db.row?.generation ?? 0) + 1;
      db.row = { sessionId, generation, active: true };
      return { sessionId, generation };
    },
    release: async (sessionId, generation) => {
      if (db.row?.sessionId === sessionId && db.row.generation === generation && db.row.active) {
        db.row.active = false;
        return true;
      }
      return false;
    },
    fetchCurrent: async () => (db.row ? { ...db.row } : null),
    openTakeoverChannel: (_u, handlers) => {
      const ch = { handlers, closed: false, deliver: true };
      channels.push(ch);
      return {
        broadcastReplaced: async (ev) => {
          for (const other of channels) {
            if (other !== ch && !other.closed && other.deliver) other.handlers.onReplaced(ev);
          }
        },
        unsubscribe: async () => {
          ch.closed = true;
        },
      };
    },
  });
  return { db, channels, makeBackend, failClaim: () => (failNextClaim = true) };
}

function makeEnv() {
  let t = 0;
  const timeouts = new Map<number, () => void>();
  const intervals = new Map<number, () => void>();
  const listeners: Record<string, Set<() => void>> = {
    online: new Set(),
    visibilitychange: new Set(),
  };
  let visible = true;
  let id = 0;
  const env: BindingEnv = {
    setInterval: (fn) => (intervals.set(++id, fn), id),
    clearInterval: (i) => intervals.delete(i as number),
    setTimeout: (fn) => (timeouts.set(++id, fn), id),
    clearTimeout: (i) => timeouts.delete(i as number),
    addWindowListener: (type, fn) => (listeners[type].add(fn), () => listeners[type].delete(fn)),
    addDocumentListener: (type, fn) => (listeners[type].add(fn), () => listeners[type].delete(fn)),
    isVisible: () => visible,
  };
  return {
    env,
    flushTimeouts: () => {
      const fns = [...timeouts.values()];
      timeouts.clear();
      fns.forEach((f) => f());
    },
    tickInterval: () => {
      t += REVALIDATE_INTERVAL_MS;
      intervals.forEach((f) => f());
    },
    fire: (type: "online" | "visibilitychange") => listeners[type].forEach((f) => f()),
    setVisible: (v: boolean) => (visible = v),
    intervalCount: () => intervals.size,
    listenerCount: () => listeners.online.size + listeners.visibilitychange.size,
  };
}

const settle = () => new Promise((r) => setTimeout(r, 0));
let seq = 0;
const ids = () => `s${++seq}`;

describe("officeGateView (decisão de montagem do OfficeScene)", () => {
  it("ACTIVE monta; CLAIMING/IDLE não; ERROR não; REPLACED não", () => {
    expect(officeGateView("ACTIVE")).toBe("scene");
    expect(officeGateView("CLAIMING")).toBe("loading");
    expect(officeGateView("IDLE")).toBe("loading");
    expect(officeGateView("ERROR")).toBe("error");
    expect(officeGateView("REPLACED")).toBe("replaced");
  });
});

describe("OfficeSessionBinder", () => {
  it("claim no acquire: CLAIMING -> ACTIVE (monta)", async () => {
    const s = makeServer();
    const e = makeEnv();
    const b = new OfficeSessionBinder(s.makeBackend, e.env, ids);
    const h = b.acquire("u", "ws");
    expect(officeGateView(h.getState().status)).toBe("loading");
    await settle();
    expect(officeGateView(h.getState().status)).toBe("scene");
  });

  it("takeover mais novo (outro dispositivo) desmonta imediatamente", async () => {
    const s = makeServer();
    const a = new OfficeSessionBinder(s.makeBackend, makeEnv().env, ids).acquire("u", "ws");
    await settle();
    const bb = new OfficeSessionBinder(s.makeBackend, makeEnv().env, ids).acquire("u", "ws");
    await settle();
    expect(officeGateView(a.getState().status)).toBe("replaced");
    expect(officeGateView(bb.getState().status)).toBe("scene");
  });

  it("REPLACED não recupera controle sozinho (retry é ignorado)", async () => {
    const s = makeServer();
    const a = new OfficeSessionBinder(s.makeBackend, makeEnv().env, ids).acquire("u", "ws");
    await settle();
    new OfficeSessionBinder(s.makeBackend, makeEnv().env, ids).acquire("u", "ws");
    await settle();
    await a.retry();
    expect(a.getState().status).toBe("REPLACED");
    expect(s.db.claims).toBe(2);
  });

  it("ERROR não monta; retry cria nova claim válida", async () => {
    const s = makeServer();
    s.failClaim();
    const h = new OfficeSessionBinder(s.makeBackend, makeEnv().env, ids).acquire("u", "ws");
    await settle();
    expect(officeGateView(h.getState().status)).toBe("error");
    await h.retry();
    expect(h.getState()).toMatchObject({ status: "ACTIVE", generation: 1 });
    expect(s.db.row?.sessionId).toBe(h.getState().sessionId);
  });

  function lostBroadcastSetup() {
    const s = makeServer();
    const e = makeEnv();
    const a = new OfficeSessionBinder(s.makeBackend, e.env, ids).acquire("u", "ws");
    return { s, e, a };
  }
  async function takeoverWithoutDelivery(s: ReturnType<typeof makeServer>) {
    s.channels.forEach((c) => (c.deliver = false));
    new OfficeSessionBinder(s.makeBackend, makeEnv().env, ids).acquire("u", "ws");
    await settle();
  }

  it("revalidação periódica (30 s) detecta takeover perdido", async () => {
    const { s, e, a } = lostBroadcastSetup();
    await settle();
    await takeoverWithoutDelivery(s);
    expect(a.getState().status).toBe("ACTIVE");
    e.tickInterval();
    await settle();
    expect(a.getState().status).toBe("REPLACED");
  });

  it("visibilitychange detecta takeover perdido", async () => {
    const { s, e, a } = lostBroadcastSetup();
    await settle();
    await takeoverWithoutDelivery(s);
    e.setVisible(false);
    e.fire("visibilitychange");
    await settle();
    expect(a.getState().status).toBe("ACTIVE");
    e.setVisible(true);
    e.fire("visibilitychange");
    await settle();
    expect(a.getState().status).toBe("REPLACED");
  });

  it("volta online detecta takeover perdido", async () => {
    const { s, e, a } = lostBroadcastSetup();
    await settle();
    await takeoverWithoutDelivery(s);
    e.fire("online");
    await settle();
    expect(a.getState().status).toBe("REPLACED");
  });

  it("reconexão do canal detecta takeover perdido", async () => {
    const { s, a } = lostBroadcastSetup();
    await settle();
    const aChannel = s.channels[0];
    await takeoverWithoutDelivery(s);
    aChannel.handlers.onSubscribed(true);
    await settle();
    expect(a.getState().status).toBe("REPLACED");
  });

  it("StrictMode: setup -> cleanup -> setup gera 1 claim, 1 canal, sem auto-takeover", async () => {
    const s = makeServer();
    const e = makeEnv();
    const b = new OfficeSessionBinder(s.makeBackend, e.env, ids);
    const h1 = b.acquire("u", "ws");
    h1.release(); // cleanup do Effect em dev
    const h2 = b.acquire("u", "ws"); // setup de novo, antes do próximo tick
    e.flushTimeouts();
    await settle();
    expect(s.db.claims).toBe(1);
    expect(s.channels.filter((c) => !c.closed)).toHaveLength(1);
    expect(h2.getState()).toMatchObject({ status: "ACTIVE", generation: 1 });
    expect(h2.controller).toBe(h1.controller);
    expect(b.size()).toBe(1);
    expect(e.intervalCount()).toBe(1);
  });

  it("unmount real faz release best-effort e remove canal e watchdog", async () => {
    const s = makeServer();
    const e = makeEnv();
    const b = new OfficeSessionBinder(s.makeBackend, e.env, ids);
    const h = b.acquire("u", "ws");
    await settle();
    h.release();
    e.flushTimeouts();
    await settle();
    expect(s.db.row?.active).toBe(false);
    expect(s.db.row?.generation).toBe(1);
    expect(s.channels.every((c) => c.closed)).toBe(true);
    expect(e.intervalCount()).toBe(0);
    expect(e.listenerCount()).toBe(0);
    expect(b.size()).toBe(0);
  });

  it("release duplicado do mesmo handle é inofensivo", async () => {
    const s = makeServer();
    const e = makeEnv();
    const b = new OfficeSessionBinder(s.makeBackend, e.env, ids);
    const h1 = b.acquire("u", "ws");
    const h2 = b.acquire("u", "ws");
    h1.release();
    h1.release();
    e.flushTimeouts();
    await settle();
    expect(h2.getState().status).toBe("ACTIVE");
    expect(vi.isMockFunction(h2.retry)).toBe(false);
  });
});
