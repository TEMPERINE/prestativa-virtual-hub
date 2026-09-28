import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import {
  CONNECT_RADIUS,
  DISCONNECT_RADIUS,
  SpatialSubscriptions,
  spatialDistance,
  type SpatialParticipantLike,
  type SpatialRoomLike,
  type SubscribablePublicationLike,
} from "../spatial-subscriptions";

class FakePub implements SubscribablePublicationLike {
  calls: boolean[] = [];
  constructor(
    public readonly trackSid: string,
    public readonly source: string,
  ) {}
  setSubscribed(v: boolean) {
    this.calls.push(v);
  }
  get subscribed() {
    return this.calls.length ? this.calls[this.calls.length - 1] : false;
  }
}

class FakeParticipant implements SpatialParticipantLike {
  trackPublications = new Map<string, FakePub>();
  constructor(
    public readonly identity: string,
    public readonly metadata = "",
  ) {}
  pub(source: string) {
    const p = new FakePub(`${this.identity}_${source}`, source);
    this.trackPublications.set(p.trackSid, p);
    return p;
  }
  all() {
    return [...this.trackPublications.values()];
  }
}

class FakeRoom implements SpatialRoomLike {
  remoteParticipants = new Map<string, FakeParticipant>();
  private h = new Map<string, Set<(...a: unknown[]) => void>>();
  on(ev: string, fn: (...a: unknown[]) => void) {
    if (!this.h.has(ev)) this.h.set(ev, new Set());
    this.h.get(ev)!.add(fn);
  }
  off(ev: string, fn: (...a: unknown[]) => void) {
    this.h.get(ev)?.delete(fn);
  }
  count() {
    let n = 0;
    for (const s of this.h.values()) n += s.size;
    return n;
  }
  emit(ev: string, ...a: unknown[]) {
    for (const fn of [...(this.h.get(ev) ?? [])]) fn(...a);
  }
  add(identity: string, sources = ["microphone", "camera"], emit = false) {
    const p = new FakeParticipant(identity);
    sources.forEach((s) => p.pub(s));
    this.remoteParticipants.set(identity, p);
    if (emit) this.emit("participantConnected", p);
    return p;
  }
  remove(identity: string) {
    const p = this.remoteParticipants.get(identity);
    this.remoteParticipants.delete(identity);
    this.emit("participantDisconnected", p);
  }
  publish(p: FakeParticipant, source: string) {
    const pub = p.pub(source);
    this.emit("trackPublished", pub, p);
    return pub;
  }
  unpublish(p: FakeParticipant, pub: FakePub) {
    p.trackPublications.delete(pub.trackSid);
    this.emit("trackUnpublished", pub, p);
  }
}

const LOBBY = { kind: "LOBBY" } as const;
const PRIVATE = { kind: "PRIVATE_ROOM", zoneId: "z1" } as const;
const ORIGIN = { x: 0, y: 0.5 };
const at = (d: number) => ({ x: d, y: 0.5 });
const IN = CONNECT_RADIUS * 0.5;
const BORDER = (CONNECT_RADIUS + DISCONNECT_RADIUS) / 2;
const FAR = DISCONNECT_RADIUS * 2;
const totalCalls = (p: FakeParticipant) => p.all().reduce((n, x) => n + x.calls.length, 0);

function setup(ids = ["a"]) {
  const room = new FakeRoom();
  const ps = ids.map((id) => room.add(id));
  const ss = new SpatialSubscriptions();
  ss.attachRoom(room, LOBBY);
  ss.setLocalPosition(ORIGIN);
  return { room, ps, ss };
}

describe("SpatialSubscriptions", () => {
  it("constantes: CONNECT < DISCONNECT = CONNECT*1.15", () => {
    expect(CONNECT_RADIUS).toBe(0.038);
    expect(DISCONNECT_RADIUS).toBeCloseTo(0.038 * 1.15, 12);
    expect(CONNECT_RADIUS).toBeLessThan(DISCONNECT_RADIUS);
  });

  it("simetria matemática da distância", () => {
    const A = { x: 0.1234, y: 0.8765 };
    const B = { x: 0.4321, y: 0.1111 };
    expect(spatialDistance(A, B)).toBe(spatialDistance(B, A));
  });

  it("1. sem Room, nenhuma subscription ocorre", () => {
    const room = new FakeRoom();
    const p = room.add("a");
    const ss = new SpatialSubscriptions();
    ss.setLocalPosition(ORIGIN);
    ss.setRemotePosition("a", at(IN));
    expect(totalCalls(p)).toBe(0);
  });

  it("2. participante sem posição permanece unsubscribed", () => {
    const { ps } = setup();
    expect(totalCalls(ps[0])).toBe(0);
  });

  it("3. sem posição local, todos permanecem unsubscribed", () => {
    const room = new FakeRoom();
    const p = room.add("a");
    const ss = new SpatialSubscriptions();
    ss.attachRoom(room, LOBBY);
    ss.setRemotePosition("a", at(IN));
    expect(totalCalls(p)).toBe(0);
  });

  it("4. fora de CONNECT_RADIUS permanece unsubscribed", () => {
    const { ps, ss } = setup();
    ss.setRemotePosition("a", at(BORDER));
    expect(totalCalls(ps[0])).toBe(0);
  });

  it("5/7/8. entra, só sai após DISCONNECT_RADIUS, e volta", () => {
    const { ps, ss } = setup();
    ss.setRemotePosition("a", at(CONNECT_RADIUS));
    expect(ps[0].all().every((p) => p.calls.join() === "true")).toBe(true);
    ss.setRemotePosition("a", at(DISCONNECT_RADIUS));
    expect(ps[0].all().every((p) => p.subscribed)).toBe(true);
    ss.setRemotePosition("a", at(DISCONNECT_RADIUS * 1.001));
    expect(ps[0].all().every((p) => p.calls.join() === "true,false")).toBe(true);
    ss.setRemotePosition("a", at(IN));
    expect(ps[0].all().every((p) => p.calls.join() === "true,false,true")).toBe(true);
  });

  it("6/29. oscilar entre os raios não gera thrashing", () => {
    const { ps, ss } = setup();
    ss.setRemotePosition("a", at(IN));
    for (let i = 0; i < 50; i++) {
      ss.setRemotePosition("a", at(i % 2 ? BORDER : CONNECT_RADIUS * 0.99));
    }
    expect(totalCalls(ps[0])).toBe(2);
    // fora oscilando entre os raios também não entra
    ss.setRemotePosition("a", at(FAR));
    for (let i = 0; i < 50; i++) ss.setRemotePosition("a", at(i % 2 ? BORDER : DISCONNECT_RADIUS));
    expect(totalCalls(ps[0])).toBe(4);
  });

  it("9/30. updates sem mudança de decisão não geram spam", () => {
    const { ps, ss } = setup();
    ss.setRemotePosition("a", at(IN));
    for (let i = 0; i < 1000; i++) {
      ss.setRemotePosition("a", at(IN * ((i % 10) / 10)));
      ss.setLocalPosition({ x: 0, y: 0.5 + (i % 3) * 1e-4 });
    }
    expect(totalCalls(ps[0])).toBe(2);
  });

  it("10. próximo publica câmera depois → assinada", () => {
    const { room, ss } = setup([]);
    const p = room.add("a", ["microphone"], true);
    ss.setRemotePosition("a", at(IN));
    const cam = room.publish(p, "camera");
    expect(cam.calls).toEqual([true]);
  });

  it("11. distante publica câmera depois → não assinada", () => {
    const { room, ss } = setup([]);
    const p = room.add("a", ["microphone"], true);
    ss.setRemotePosition("a", at(FAR));
    const cam = room.publish(p, "camera");
    expect(cam.calls).toEqual([]);
  });

  it("12. roster já existente ao anexar é processado", () => {
    const room = new FakeRoom();
    const p = room.add("a", ["microphone", "camera", "screen_share"]);
    const ss = new SpatialSubscriptions();
    ss.setLocalPosition(ORIGIN);
    ss.setRemotePosition("a", at(IN));
    ss.attachRoom(room, LOBBY);
    expect(p.all().every((x) => x.calls.join() === "true")).toBe(true);
  });

  it("13. ParticipantConnected é processado", () => {
    const { room, ss } = setup([]);
    ss.setRemotePosition("b", at(IN));
    const p = room.add("b", ["camera"], true);
    expect(p.all()[0].calls).toEqual([true]);
  });

  it("14. ParticipantDisconnected remove estado do usuário", () => {
    const { room, ss } = setup();
    ss.setRemotePosition("a", at(IN));
    expect(ss.getInRange()).toEqual(["a"]);
    room.remove("a");
    expect(ss.getInRange()).toEqual([]);
  });

  it("15. TrackUnpublished limpa só aquela publication", () => {
    const { room, ps, ss } = setup();
    ss.setRemotePosition("a", at(IN));
    const [mic, cam] = ps[0].all();
    room.unpublish(ps[0], cam);
    ss.setRemotePosition("a", at(FAR));
    expect(mic.calls).toEqual([true, false]);
    expect(cam.calls).toEqual([true]);
  });

  it("16/17/18. decisões independentes; mover um não afeta os demais", () => {
    const { ps, ss } = setup(["a", "b", "c"]);
    ss.setRemotePosition("a", at(IN));
    ss.setRemotePosition("b", { x: 0, y: 0.5 - IN });
    ss.setRemotePosition("c", at(FAR));
    expect(ss.getInRange()).toEqual(["a", "b"]);
    expect(totalCalls(ps[2])).toBe(0);
    const before = [totalCalls(ps[1]), totalCalls(ps[2])];
    ss.setRemotePosition("a", at(FAR));
    expect(ss.getInRange()).toEqual(["b"]);
    expect([totalCalls(ps[1]), totalCalls(ps[2])]).toEqual(before);
  });

  it("19/20/21. trocar Room remove listeners, ignora eventos antigos e limpa estado", () => {
    const { room: r1, ps, ss } = setup();
    ss.setRemotePosition("a", at(IN));
    const r2 = new FakeRoom();
    ss.attachRoom(r2, LOBBY);
    expect(r1.count()).toBe(0);
    expect(ss.getInRange()).toEqual([]);
    const late = r1.publish(ps[0], "screen_share");
    r1.emit("participantConnected", r1.add("z", ["camera"]));
    ss.setRemotePosition("a", at(FAR));
    expect(late.calls).toEqual([]);
    expect(
      ps[0]
        .all()
        .filter((p) => p !== late)
        .every((p) => p.calls.join() === "true"),
    ).toBe(true);
    const a2 = r2.add("a", ["camera"], true);
    ss.setRemotePosition("a", at(IN));
    expect(a2.all()[0].calls).toEqual([true]);
  });

  it("22. dispose impede comandos futuros", () => {
    const { room, ps, ss } = setup();
    ss.dispose();
    ss.setRemotePosition("a", at(IN));
    room.emit("participantConnected", room.add("b", ["camera"]));
    ss.attachRoom(room, LOBBY);
    expect(totalCalls(ps[0])).toBe(0);
    expect(room.count()).toBe(0);
  });

  it("23/24. screen_share e screen_share_audio seguem a mesma decisão", () => {
    const room = new FakeRoom();
    const p = room.add("a", ["screen_share", "screen_share_audio"]);
    const ss = new SpatialSubscriptions();
    ss.attachRoom(room, LOBBY);
    ss.setLocalPosition(ORIGIN);
    ss.setRemotePosition("a", at(IN));
    ss.setRemotePosition("a", at(FAR));
    expect(p.all().map((x) => [x.source, x.calls.join()])).toEqual([
      ["screen_share", "true,false"],
      ["screen_share_audio", "true,false"],
    ]);
  });

  it("25. PRIVATE_ROOM: nenhuma chamada e nenhum listener", () => {
    const room = new FakeRoom();
    const p = room.add("a", ["camera"]);
    const ss = new SpatialSubscriptions();
    ss.setLocalPosition(ORIGIN);
    ss.setRemotePosition("a", at(IN));
    ss.attachRoom(room, PRIVATE);
    room.publish(p, "microphone");
    expect(totalCalls(p)).toBe(0);
    expect(room.count()).toBe(0);
    // lobby → private desanexa
    const lobby = new FakeRoom();
    ss.attachRoom(lobby, LOBBY);
    ss.attachRoom(room, PRIVATE);
    expect(lobby.count()).toBe(0);
  });

  it("26/27. sem dependência de desiredPeers/videoVisibleIds/ownerId/clientId", () => {
    const src = readFileSync("src/lib/rtc/spatial-subscriptions.ts", "utf8")
      .split("\n")
      .filter((l) => !l.trim().startsWith("//"))
      .join("\n");
    for (const w of ["desiredPeers", "videoVisibleIds", "ownerId", "clientId", "metadata"]) {
      expect(src).not.toContain(w);
    }
  });

  it("28. identidade usada é participant.identity", () => {
    const room = new FakeRoom();
    const p = new FakeParticipant("uuid-2", JSON.stringify({ ownerId: "uuid-1" }));
    p.pub("camera");
    room.remoteParticipants.set("uuid-2", p);
    const ss = new SpatialSubscriptions();
    ss.attachRoom(room, LOBBY);
    ss.setLocalPosition(ORIGIN);
    ss.setRemotePosition("uuid-1", at(IN));
    expect(totalCalls(p)).toBe(0);
    ss.setRemotePosition("uuid-2", at(IN));
    expect(p.all()[0].calls).toEqual([true]);
  });
});
