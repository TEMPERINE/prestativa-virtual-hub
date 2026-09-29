/**
 * RTC v2 — Etapa 14A: instrumentação SOMENTE diagnóstica do áudio.
 *
 * Observa (nunca controla) a Room LiveKit crua, a track local de microfone e
 * as tracks remotas de áudio, emitindo eventos em rtc_events:
 *   AUDIO_LOCAL_TRACK  — ended/mute/unmute da MediaStreamTrack + restarted da LocalTrack
 *   AUDIO_LOCAL_PUB    — localTrackPublished/Unpublished, trackMuted/Unmuted locais
 *   AUDIO_MIC_SWAP     — troca da track do mic (toggle OFF→ON ou troca de device)
 *                        + checagem 3 s depois (publicação/sender realmente na nova track)
 *   AUDIO_REMOTE_TRACK — published/subscribed/unsubscribed/muted/unmuted/failed/status por identidade
 *   AUDIO_TX_STATS / AUDIO_RX_STATS — getStats a cada AUDIO_STATS_INTERVAL_MS em PRIVATE_ROOM
 *   AUDIO_SNAPSHOT     — estado compacto nos eventos críticos
 *
 * Regras: não chama nenhum método que muda estado (mute, publish, unpublish,
 * setSubscribed, replaceTrack, setParameters, reconnect). Só leitura + getStats.
 * Toda exceção é engolida. Sem áudio, SDP, ICE, IP, tokens: ids encurtados a 8 chars.
 */
import {
  emitTelemetry,
  type RtcTelemetrySink,
  type RtcTelemetryEventType,
} from "./rtc-telemetry-types";

export const AUDIO_STATS_INTERVAL_MS = 2000;
export const AUDIO_SWAP_CHECK_MS = 3000;

export interface DiagTimers {
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(h: unknown): void;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(h: unknown): void;
}

const defaultTimers: DiagTimers = {
  setInterval: (fn, ms) => globalThis.setInterval(fn, ms),
  clearInterval: (h) => globalThis.clearInterval(h as ReturnType<typeof setInterval>),
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (h) => globalThis.clearTimeout(h as ReturnType<typeof setTimeout>),
};

/** Superfície mínima da track local de mic que o diagnóstico lê. */
export interface DiagMicTrack {
  readonly mediaStreamTrack?: MediaStreamTrack;
  readonly lk?: unknown;
}

export interface AudioDiagnosticsDeps {
  sink?: RtcTelemetrySink;
  getMicIntent: () => boolean;
  getMicTrack: () => DiagMicTrack | null;
  getRoomName?: () => string | null;
  timers?: DiagTimers;
}

type Handler = (...a: unknown[]) => void;
interface RawRoomLike {
  on(e: string, fn: Handler): unknown;
  off(e: string, fn: Handler): unknown;
  state?: string;
  remoteParticipants?: Map<string, unknown>;
  localParticipant?: unknown;
}

// ─── helpers de leitura segura ───────────────────────────────
const short = (v: unknown): string | null =>
  typeof v === "string" && v.length > 0 ? v.replace(/[{}]/g, "").slice(0, 8) : null;
const g = (o: unknown, k: string): unknown => {
  try {
    return o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined;
  } catch {
    return undefined;
  }
};
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const bool = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" ? v.slice(0, 32) : null);

function mstInfo(mst: unknown) {
  return {
    mstId: short(g(mst, "id")),
    readyState: str(g(mst, "readyState")),
    enabled: bool(g(mst, "enabled")),
    muted: bool(g(mst, "muted")),
  };
}

/** Etapa 14B: dispositivo/constraints REAIS da captura (sem conteúdo de áudio). */
function captureInfo(mst: unknown) {
  const call = (k: string): Record<string, unknown> | null => {
    try {
      const f = g(mst, k);
      return typeof f === "function"
        ? ((f as () => Record<string, unknown>).call(mst) ?? null)
        : null;
    } catch {
      return null;
    }
  };
  const st = call("getSettings");
  const cs = call("getConstraints");
  const reqDev = cs ? g(cs, "deviceId") : null;
  const reqId = typeof reqDev === "string" ? reqDev : (g(reqDev, "exact") ?? g(reqDev, "ideal"));
  const lbl = str(g(mst, "label"));
  return {
    reqDeviceId: short(reqId),
    realDeviceId: short(st ? g(st, "deviceId") : null),
    realGroupId: short(st ? g(st, "groupId") : null),
    label: lbl ? lbl.slice(0, 48) : null,
    ec: st ? bool(g(st, "echoCancellation")) : null,
    ns: st ? bool(g(st, "noiseSuppression")) : null,
    agc: st ? bool(g(st, "autoGainControl")) : null,
    channelCount: st ? (g(st, "channelCount") ?? null) : null,
    sampleRate: st ? (g(st, "sampleRate") ?? null) : null,
    reqEc: cs ? (g(cs, "echoCancellation") ?? null) : null,
    reqNs: cs ? (g(cs, "noiseSuppression") ?? null) : null,
    reqAgc: cs ? (g(cs, "autoGainControl") ?? null) : null,
  };
}

function mapValues(m: unknown): unknown[] {
  try {
    return m instanceof Map ? [...m.values()] : [];
  } catch {
    return [];
  }
}

function isMicPub(pub: unknown): boolean {
  return g(pub, "source") === "microphone" || (g(pub, "kind") === "audio" && !g(pub, "source"));
}

function senderOf(track: unknown): unknown {
  return g(track, "sender");
}

export class AudioDiagnostics {
  private readonly timers: DiagTimers;
  private room: RawRoomLike | null = null;
  private roomHandlers: Array<[string, Handler]> = [];
  private ctxKind: string | null = null;
  private zoneId: string | null = null;
  private statsTimer: unknown = null;
  private swapTimer: unknown = null;
  private micMst: MediaStreamTrack | null = null;
  private micLk: unknown = null;
  private micUnbind: Array<() => void> = [];
  private prevMic: { mstId: string | null; pubSid: string | null } | null = null;
  private pendingReason: {
    reason: string;
    deviceFrom: string | null;
    deviceTo: string | null;
  } | null = null;
  private disposed = false;

  constructor(private readonly deps: AudioDiagnosticsDeps) {
    this.timers = deps.timers ?? defaultTimers;
  }

  // ─── API ─────────────────────────────────────────────────

  /** Anexa à Room crua (livekit-client). `raw` ausente = no-op (testes/fakes). */
  attachRoom(raw: unknown, ctx: { kind: string; zoneId?: string } | null): void {
    this.safe(() => {
      if (this.disposed) return;
      this.detachRoom();
      if (!raw || typeof (raw as RawRoomLike).on !== "function") return;
      const room = raw as RawRoomLike;
      this.room = room;
      this.ctxKind = ctx?.kind ?? null;
      this.zoneId = ctx && ctx.kind === "PRIVATE_ROOM" ? (ctx.zoneId ?? null) : null;
      const on = (e: string, fn: Handler) => {
        const h: Handler = (...a) => this.safe(() => fn(...a));
        room.on(e, h);
        this.roomHandlers.push([e, h]);
      };
      on("participantConnected", (p) => this.snapshot("participant_connected", g(p, "identity")));
      on("participantDisconnected", (p) =>
        this.snapshot("participant_disconnected", g(p, "identity")),
      );
      on("localTrackPublished", (pub) => this.localPub("local_published", pub));
      on("localTrackUnpublished", (pub) => this.localPub("local_unpublished", pub));
      on("trackMuted", (pub, p) => this.muteEvent("muted", pub, p));
      on("trackUnmuted", (pub, p) => this.muteEvent("unmuted", pub, p));
      on("trackPublished", (pub, p) => this.remote("published", pub, p));
      on("trackUnpublished", (pub, p) => this.remote("unpublished", pub, p));
      on("trackSubscribed", (track, pub, p) => this.remote("subscribed", pub, p, track));
      on("trackUnsubscribed", (track, pub, p) => this.remote("unsubscribed", pub, p, track));
      on("trackSubscriptionFailed", (sid, p) =>
        this.remote("subscription_failed", { trackSid: sid, source: "microphone" }, p),
      );
      on("trackSubscriptionStatusChanged", (pub, status, p) =>
        this.remote("subscription_status", pub, p, undefined, str(status)),
      );
      this.snapshot("room_attached", null);
      if (this.ctxKind === "PRIVATE_ROOM") {
        this.statsTimer = this.timers.setInterval(
          () => void this.sampleStats(),
          AUDIO_STATS_INTERVAL_MS,
        );
      }
    });
  }

  detachRoom(): void {
    this.safe(() => {
      if (this.statsTimer != null) this.timers.clearInterval(this.statsTimer);
      this.statsTimer = null;
      const room = this.room;
      this.room = null;
      if (room) for (const [e, h] of this.roomHandlers) room.off(e, h);
      this.roomHandlers = [];
    });
  }

  /** Chamar a cada mudança do LocalMedia; detecta troca de track do mic. */
  onLocalMediaChange(): void {
    this.safe(() => {
      if (this.disposed) return;
      const t = this.deps.getMicTrack();
      const mst = (t?.mediaStreamTrack ?? null) as MediaStreamTrack | null;
      if (mst === this.micMst) return;
      const prevInfo = this.micMst ? mstInfo(this.micMst) : null;
      this.bindMic(mst, t?.lk ?? null);
      if (!mst) {
        this.prevMic = { mstId: prevInfo?.mstId ?? null, pubSid: this.micPubSid() };
        return;
      }
      const reason = this.pendingReason;
      this.pendingReason = null;
      this.tel("AUDIO_MIC_SWAP", {
        reason: reason?.reason ?? "mic_on",
        prevMstId: this.prevMic?.mstId ?? prevInfo?.mstId ?? null,
        prevPublicationSid: this.prevMic?.pubSid ?? null,
        deviceFrom: reason?.deviceFrom ?? null,
        deviceTo: reason?.deviceTo ?? null,
        ...mstInfo(mst),
        ...captureInfo(mst),
        status: "track_created",
      });
      this.prevMic = null;
      if (this.swapTimer != null) this.timers.clearTimeout(this.swapTimer);
      this.swapTimer = this.timers.setTimeout(() => {
        this.swapTimer = null;
        this.safe(() => this.swapCheck(mst, reason?.reason ?? "mic_on"));
      }, AUDIO_SWAP_CHECK_MS);
    });
  }

  /** O hook avisa antes de recapturar por troca de device (ids encurtados). */
  noteDeviceChange(from: string | null, to: string | null): void {
    this.pendingReason = { reason: "device_change", deviceFrom: short(from), deviceTo: short(to) };
  }

  dispose(): void {
    if (this.disposed) return;
    this.detachRoom();
    this.safe(() => {
      if (this.swapTimer != null) this.timers.clearTimeout(this.swapTimer);
      this.swapTimer = null;
      this.bindMic(null, null);
    });
    this.disposed = true;
  }

  // ─── internos ────────────────────────────────────────────

  private bindMic(mst: MediaStreamTrack | null, lk: unknown): void {
    for (const u of this.micUnbind) u();
    this.micUnbind = [];
    this.micMst = mst;
    this.micLk = lk;
    if (mst && typeof mst.addEventListener === "function") {
      for (const ev of ["ended", "mute", "unmute"] as const) {
        const h = () => this.safe(() => this.localTrackEvent(ev));
        mst.addEventListener(ev, h);
        this.micUnbind.push(() => mst.removeEventListener(ev, h));
      }
    }
    const lkOn = g(lk, "on");
    const lkOff = g(lk, "off");
    if (typeof lkOn === "function" && typeof lkOff === "function") {
      const h = () =>
        this.safe(() => {
          this.localTrackEvent("restarted");
          // restartTrack/setDeviceId trocam a MediaStreamTrack: re-vincula.
          this.onLocalMediaChange();
        });
      (lkOn as (e: string, f: Handler) => void).call(lk, "restarted", h);
      this.micUnbind.push(() =>
        (lkOff as (e: string, f: Handler) => void).call(lk, "restarted", h),
      );
    }
  }

  private localTrackEvent(event: string): void {
    this.tel("AUDIO_LOCAL_TRACK", {
      event,
      ...mstInfo(this.micMst),
      publicationSid: this.micPubSid(),
      trackSid: short(g(this.micLk, "sid")) ?? null,
    });
    if (event === "ended" || event === "mute" || event === "unmute")
      this.snapshot(`local_${event}`, null);
  }

  private localPub(event: string, pub: unknown): void {
    const track = g(pub, "track");
    this.tel("AUDIO_LOCAL_PUB", {
      event,
      source: str(g(pub, "source")),
      publicationSid: short(g(pub, "trackSid")),
      ...mstInfo(g(track, "mediaStreamTrack")),
      muted: bool(g(pub, "isMuted")),
      ...this.senderInfo(track),
    });
    this.snapshot(event, null);
  }

  private muteEvent(event: string, pub: unknown, p: unknown): void {
    const isLocal = p && g(this.room?.localParticipant, "identity") === g(p, "identity");
    if (isLocal) {
      this.tel("AUDIO_LOCAL_PUB", {
        event: `track_${event}`,
        source: str(g(pub, "source")),
        publicationSid: short(g(pub, "trackSid")),
        ...mstInfo(g(g(pub, "track"), "mediaStreamTrack")),
        muted: bool(g(pub, "isMuted")),
      });
      this.snapshot(`local_track_${event}`, null);
    } else {
      this.remote(event, pub, p);
    }
  }

  private remote(
    event: string,
    pub: unknown,
    p: unknown,
    track?: unknown,
    status?: string | null,
  ): void {
    const source = str(g(pub, "source")) ?? str(g(track, "source"));
    const kind = str(g(pub, "kind")) ?? str(g(track, "kind"));
    if (source !== "microphone" && kind !== "audio" && event !== "subscription_failed") return;
    const t = track ?? g(pub, "track");
    this.tel("AUDIO_REMOTE_TRACK", {
      event,
      identity: short(g(p, "identity")),
      source,
      publicationSid: short(g(pub, "trackSid")),
      subscribed: bool(g(pub, "isSubscribed")),
      muted: bool(g(pub, "isMuted")),
      readyState: str(g(g(t, "mediaStreamTrack"), "readyState")),
      mstId: short(g(g(t, "mediaStreamTrack"), "id")),
      status: status ?? null,
    });
    if (event !== "subscription_status") this.snapshot(`remote_${event}`, g(p, "identity"));
  }

  private micPubs(): unknown[] {
    return mapValues(g(this.room?.localParticipant, "audioTrackPublications")).filter(isMicPub);
  }
  private micPubSid(): string | null {
    const pub = this.micPubs()[0];
    return pub ? short(g(pub, "trackSid")) : null;
  }

  private senderInfo(track: unknown) {
    const sender = senderOf(track);
    const sTrack = g(sender, "track");
    const localMst = g(track, "mediaStreamTrack");
    return {
      senderTrackId: short(g(sTrack, "id")),
      senderReadyState: str(g(sTrack, "readyState")),
      senderMatchesLocal:
        sender == null ? null : !!sTrack && !!localMst && g(sTrack, "id") === g(localMst, "id"),
    };
  }

  private swapCheck(mst: MediaStreamTrack, reason: string): void {
    if (this.disposed) return;
    const pubs = this.micPubs();
    const pub =
      pubs.find((p) => g(g(g(p, "track"), "mediaStreamTrack"), "id") === mst.id) ?? pubs[0];
    const track = g(pub, "track");
    const sInfo = this.senderInfo(track);
    const currentMst = this.deps.getMicTrack()?.mediaStreamTrack;
    this.tel("AUDIO_MIC_SWAP", {
      reason,
      status: "check",
      ...mstInfo(mst),
      ...captureInfo(mst),
      micIntent: this.deps.getMicIntent(),
      micPublications: pubs.length,
      publicationSid: pub ? short(g(pub, "trackSid")) : null,
      publishResult: pub
        ? g(g(track, "mediaStreamTrack"), "id") === mst.id
          ? "published_new_track"
          : "published_other_track"
        : this.room
          ? "not_published"
          : "no_room",
      ...sInfo,
      senderMatchesLocal:
        sInfo.senderTrackId == null ? null : short(currentMst?.id) === sInfo.senderTrackId,
    });
  }

  private snapshot(reason: string, identity: unknown): void {
    const room = this.room;
    if (!room) return;
    const parts: string[] = [];
    const lp = room.localParticipant;
    const mic = this.micPubs()
      .map((p) => {
        const mst = g(g(p, "track"), "mediaStreamTrack");
        return `me:${short(g(p, "trackSid"))}:m${g(p, "isMuted") ? 1 : 0}:${str(g(mst, "readyState")) ?? "-"}`;
      })
      .join(",");
    parts.push(mic || "me:nomic");
    for (const p of mapValues(room.remoteParticipants)) {
      const pubs = mapValues(g(p, "audioTrackPublications")).filter(isMicPub);
      const d = pubs
        .map(
          (pub) =>
            `s${g(pub, "isSubscribed") ? 1 : 0}m${g(pub, "isMuted") ? 1 : 0}${
              str(g(g(g(pub, "track"), "mediaStreamTrack"), "readyState"))?.[0] ?? "-"
            }`,
        )
        .join("/");
      parts.push(`${short(g(p, "identity"))}:${d || "nomic"}`);
    }
    void lp;
    this.tel("AUDIO_SNAPSHOT", {
      reason,
      identity: short(identity),
      participants: mapValues(room.remoteParticipants).length,
      connectionState: str(room.state),
      micIntent: this.deps.getMicIntent(),
      ...mstInfo(this.micMst),
      snapshot: parts.join(";"),
    });
  }

  private async sampleStats(): Promise<void> {
    const room = this.room;
    if (!room || this.disposed) return;
    // TX: cada publicação de mic local.
    for (const pub of this.micPubs()) {
      const track = g(pub, "track");
      const sender = senderOf(track) as { getStats?: () => Promise<RTCStatsReport> } | undefined;
      let report: RTCStatsReport | undefined;
      try {
        report = sender?.getStats ? await sender.getStats() : undefined;
      } catch {
        report = undefined;
      }
      if (this.room !== room) return;
      const out: Record<string, unknown> = {};
      const media: Record<string, unknown> = {};
      report?.forEach((s: Record<string, unknown>) => {
        if (s.type === "outbound-rtp" && (s.kind === "audio" || s.mediaType === "audio")) {
          out.bytesSent = num(s.bytesSent);
          out.packetsSent = num(s.packetsSent);
          out.mediaSourceId = short(s.mediaSourceId);
          out.outboundActive = bool(s.active);
        } else if (s.type === "media-source" && s.kind === "audio") {
          media.audioLevel = num(s.audioLevel);
          media.trackIdentifier = short(s.trackIdentifier);
        }
      });
      this.tel("AUDIO_TX_STATS", {
        publicationSid: short(g(pub, "trackSid")),
        muted: bool(g(pub, "isMuted")),
        micIntent: this.deps.getMicIntent(),
        micPublications: this.micPubs().length,
        ...out,
        ...media,
        ...this.senderInfo(track),
        status: report ? "ok" : "no_sender",
      });
    }
    // RX: cada track remota de áudio (mic).
    for (const p of mapValues(room.remoteParticipants)) {
      for (const pub of mapValues(g(p, "audioTrackPublications")).filter(isMicPub)) {
        const track = g(pub, "track") as {
          getRTCStatsReport?: () => Promise<RTCStatsReport | undefined>;
        };
        let report: RTCStatsReport | undefined;
        try {
          report = track?.getRTCStatsReport ? await track.getRTCStatsReport() : undefined;
        } catch {
          report = undefined;
        }
        if (this.room !== room) return;
        const inb: Record<string, unknown> = {};
        report?.forEach((s: Record<string, unknown>) => {
          if (s.type === "inbound-rtp" && (s.kind === "audio" || s.mediaType === "audio")) {
            inb.bytesReceived = num(s.bytesReceived);
            inb.packetsReceived = num(s.packetsReceived);
            inb.packetsLost = num(s.packetsLost);
            inb.audioLevel = num(s.audioLevel);
            inb.jitter = num(s.jitter);
            inb.trackIdentifier = short(s.trackIdentifier);
          }
        });
        this.tel("AUDIO_RX_STATS", {
          identity: short(g(p, "identity")),
          publicationSid: short(g(pub, "trackSid")),
          subscribed: bool(g(pub, "isSubscribed")),
          muted: bool(g(pub, "isMuted")),
          readyState: str(g(g(track, "mediaStreamTrack"), "readyState")),
          ...inb,
          status: report ? "ok" : track ? "no_report" : "no_track",
        });
      }
    }
  }

  private tel(type: RtcTelemetryEventType, metadata: Record<string, unknown>): void {
    let roomName: string | null = null;
    try {
      roomName = this.deps.getRoomName?.() ?? null;
    } catch {
      roomName = null;
    }
    emitTelemetry(this.deps.sink, type, {
      context: this.ctxKind,
      zoneId: this.zoneId,
      roomName,
      metadata: { micIntent: this.safeIntent(), ...metadata },
    });
  }

  private safeIntent(): boolean | null {
    try {
      return this.deps.getMicIntent();
    } catch {
      return null;
    }
  }

  private safe(fn: () => void): void {
    try {
      fn();
    } catch {
      /* diagnóstico nunca altera o RTC */
    }
  }
}
