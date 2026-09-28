import { describe, it, expect } from "vitest";
import {
  RemoteMedia,
  type RemoteParticipantLike,
  type RemotePublicationLike,
  type RemoteRoomLike,
} from "../remote-media";

class FakePub implements RemotePublicationLike {
  isSubscribed = false;
  isMuted = false;
  track?: unknown;
  constructor(
    public readonly trackSid: string,
    public readonly source: string,
  ) {}
}

class FakeParticipant implements RemoteParticipantLike {
  trackPublications = new Map<string, FakePub>();
  setSubscribedCalls = 0;
  constructor(
    public readonly identity: string,
    public readonly metadata = "",
  ) {}
  setSubscribed() {
    this.setSubscribedCalls++;
  }
}

/** Room fake que imita o livekit-client: mutação + emissão do evento. */
class FakeRoom implements RemoteRoomLike {
  remoteParticipants = new Map<string, FakeParticipant>();
  private handlers = new Map<string, Set<(...a: unknown[]) => void>>();
  on(ev: string, fn: (...a: unknown[]) => void) {
    if (!this.handlers.has(ev)) this.handlers.set(ev, new Set());
    this.handlers.get(ev)!.add(fn);
  }
  off(ev: string, fn: (...a: unknown[]) => void) {
    this.handlers.get(ev)?.delete(fn);
  }
  listenerCount() {
    let n = 0;
    for (const s of this.handlers.values()) n += s.size;
    return n;
  }
  emit(ev: string, ...a: unknown[]) {
    for (const fn of [...(this.handlers.get(ev) ?? [])]) fn(...a);
  }
  join(identity: string) {
    const p = new FakeParticipant(identity);
    this.remoteParticipants.set(identity, p);
    this.emit("participantConnected", p);
    return p;
  }
  leave(identity: string) {
    const p = this.remoteParticipants.get(identity);
    this.remoteParticipants.delete(identity);
    this.emit("participantDisconnected", p);
  }
  publish(p: FakeParticipant, sid: string, source: string) {
    const pub = new FakePub(sid, source);
    p.trackPublications.set(sid, pub);
    this.emit("trackPublished", pub, p);
    return pub;
  }
  subscribe(p: FakeParticipant, pub: FakePub) {
    pub.isSubscribed = true;
    pub.track = { sid: pub.trackSid };
    this.emit("trackSubscribed", pub.track, pub, p);
  }
  unsubscribe(p: FakeParticipant, pub: FakePub) {
    pub.isSubscribed = false;
    pub.track = undefined;
    this.emit("trackUnsubscribed", undefined, pub, p);
  }
}

const ids = (rm: RemoteMedia) => rm.getSnapshot().participants.map((p) => p.identity);

/** Simula N clientes na mesma Room: cada um vê todos menos ele. */
function mesh(n: number) {
  const users = Array.from({ length: n }, (_, i) => `user-${i}`);
  const rooms = users.map(() => new FakeRoom());
  const rms = users.map(() => new RemoteMedia());
  rms.forEach((rm, i) => rm.attachRoom(rooms[i]));
  users.forEach((u, i) => rooms.forEach((r, j) => j !== i && r.join(u)));
  return { users, rms };
}

describe("RemoteMedia", () => {
  it("19. roster inicial lê room.remoteParticipants", () => {
    const room = new FakeRoom();
    room.remoteParticipants.set("a", new FakeParticipant("a"));
    room.remoteParticipants.set("b", new FakeParticipant("b"));
    const rm = new RemoteMedia();
    rm.attachRoom(room);
    expect(ids(rm)).toEqual(["a", "b"]);
  });

  it("20. participante novo entra uma única vez", () => {
    const room = new FakeRoom();
    const rm = new RemoteMedia();
    rm.attachRoom(room);
    const p = room.join("a");
    room.emit("participantConnected", p); // evento duplicado
    expect(ids(rm)).toEqual(["a"]);
  });

  it("21. participante desconectado é removido", () => {
    const room = new FakeRoom();
    const rm = new RemoteMedia();
    rm.attachRoom(room);
    room.join("a");
    room.join("b");
    room.leave("a");
    expect(ids(rm)).toEqual(["b"]);
  });

  it("22. 2 usuários produzem roster simétrico", () => {
    const { rms } = mesh(2);
    expect(ids(rms[0])).toEqual(["user-1"]);
    expect(ids(rms[1])).toEqual(["user-0"]);
  });

  it("23. 3 usuários produzem roster simétrico", () => {
    const { users, rms } = mesh(3);
    rms.forEach((rm, i) => expect(ids(rm)).toEqual(users.filter((_, j) => j !== i)));
  });

  it("24/25. identidade = participant.identity, sem dedup por ownerId/clientId", () => {
    const room = new FakeRoom();
    const rm = new RemoteMedia();
    rm.attachRoom(room);
    room.join("uuid-1:tabA");
    room.join("uuid-1:tabB");
    const p = new FakeParticipant("uuid-2", JSON.stringify({ ownerId: "uuid-1" }));
    room.remoteParticipants.set(p.identity, p);
    room.emit("participantConnected", p);
    expect(ids(rm)).toEqual(["uuid-1:tabA", "uuid-1:tabB", "uuid-2"]);
  });

  it("26/27/28. tracks por source; subscribe/unsubscribe afetam só a track certa", () => {
    const room = new FakeRoom();
    const rm = new RemoteMedia();
    rm.attachRoom(room);
    const a = room.join("a");
    const b = room.join("b");
    const mic = room.publish(a, "TR_mic", "microphone");
    const cam = room.publish(a, "TR_cam", "camera");
    const scr = room.publish(a, "TR_scr", "screen_share");
    const scra = room.publish(a, "TR_scra", "screen_share_audio");
    [mic, cam, scr, scra].forEach((p) => room.subscribe(a, p));
    let pa = rm.getSnapshot().participants.find((p) => p.identity === "a")!;
    expect(pa.microphone?.sid).toBe("TR_mic");
    expect(pa.camera?.sid).toBe("TR_cam");
    expect(pa.screenShare?.sid).toBe("TR_scr");
    expect(pa.screenShareAudio?.sid).toBe("TR_scra");
    expect(pa.camera?.subscribed).toBe(true);
    expect(rm.getSnapshot().participants.find((p) => p.identity === "b")!.camera).toBeNull();
    room.unsubscribe(a, cam);
    pa = rm.getSnapshot().participants.find((p) => p.identity === "a")!;
    expect(pa.camera).toMatchObject({ subscribed: false, track: null });
    expect(pa.microphone?.subscribed).toBe(true);
    expect(pa.screenShare?.subscribed).toBe(true);
    mic.isMuted = true;
    room.emit("trackMuted", mic, a);
    expect(rm.getSnapshot().participants.find((p) => p.identity === "a")!.microphone?.muted).toBe(
      true,
    );
    void b;
  });

  it("29/30. troca de Room remove listeners e ignora eventos da antiga", () => {
    const r1 = new FakeRoom();
    const r2 = new FakeRoom();
    const rm = new RemoteMedia();
    rm.attachRoom(r1);
    r1.join("old");
    expect(r1.listenerCount()).toBeGreaterThan(0);
    rm.attachRoom(r2);
    expect(r1.listenerCount()).toBe(0);
    r2.join("new");
    r1.join("late"); // evento atrasado
    r1.leave("old");
    expect(ids(rm)).toEqual(["new"]);
  });

  it("31. RemoteMedia não chama setSubscribed()", () => {
    const room = new FakeRoom();
    const rm = new RemoteMedia();
    rm.attachRoom(room);
    const a = room.join("a");
    room.publish(a, "TR_cam", "camera");
    rm.detachRoom(room);
    expect(a.setSubscribedCalls).toBe(0);
  });

  it("32. participante sem track (lobby autoSubscribe:false) continua no roster", () => {
    const room = new FakeRoom();
    const rm = new RemoteMedia();
    rm.attachRoom(room);
    const a = room.join("a");
    room.publish(a, "TR_cam", "camera"); // publicado mas não assinado
    const pa = rm.getSnapshot().participants[0];
    expect(pa.identity).toBe("a");
    expect(pa.camera).toMatchObject({ subscribed: false, track: null });
    room.join("b");
    expect(rm.getSnapshot().participants[1].camera).toBeNull();
  });
});
