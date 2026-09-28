// RTC v2 Etapa 8 — LocalMedia.
//
// Único dono do estado local de microfone, câmera e screen share.
// NÃO decide Room/zona, não calcula proximidade, não gera token, não cria Room
// e nunca chama setSubscribed(). Só captura, publica e despublica tracks na
// Room que o LiveKitRoomManager lhe entregar via attachRoom/detachRoom.
//
// Invariantes:
//  - começa mic OFF / cam OFF e não captura nada até ação explícita;
//  - intents de mic/cam pertencem à sessão, não à Room: ao anexar nova Room,
//    o que estava ON é republicado (reutilizando a MESMA captura);
//  - no máximo uma Room anexada → nunca publicação simultânea em duas Rooms;
//  - screen share não tem intent: termina em qualquer troca de Room/contexto;
//  - reattach da MESMA Room (reconnect de rede) é no-op;
//  - OFF = unpublish + stop da captura;
//  - erro de captura → status "error", intent OFF, sem retry automático;
//  - dispose() para tudo e invalida Promises pendentes.
//
// Não ligado ao produto. RTC v1 (useLiveKit.ts) permanece intocado.

import {
  emitTelemetry,
  telemetryObjectKey,
  type RtcTelemetrySink,
} from "./rtc-telemetry-types";

export type LocalSource = "microphone" | "camera" | "screen_share" | "screen_share_audio";

/** Track local mínima. */
export interface LocalTrackLike {
  readonly source: LocalSource;
  stop(): void;
  /** Dispara quando a captura termina fora do nosso controle (ex.: "Parar compartilhamento"). Retorna unsubscribe. */
  onEnded(fn: () => void): () => void;
}

/** Superfície mínima de uma Room para publicar. */
export interface PublishTargetLike {
  publishTrack(track: LocalTrackLike): Promise<void>;
  unpublishTrack(track: LocalTrackLike): Promise<void>;
}

export interface CaptureAdapter {
  createMicrophoneTrack(): Promise<LocalTrackLike>;
  createCameraTrack(): Promise<LocalTrackLike>;
  /** Pode retornar vídeo + áudio de tela. */
  createScreenTracks(): Promise<LocalTrackLike[]>;
}

export type DeviceStatus = "off" | "starting" | "on" | "error";

export interface DeviceState {
  intent: boolean;
  status: DeviceStatus;
  error: string | null;
}

export interface ScreenState {
  status: DeviceStatus;
  error: string | null;
}

export interface LocalMediaSnapshot {
  microphone: DeviceState;
  camera: DeviceState;
  screenShare: ScreenState;
  roomAttached: boolean;
  disposed: boolean;
}

type Kind = "microphone" | "camera";

interface DeviceSlot {
  intent: boolean;
  status: DeviceStatus;
  error: string | null;
  track: LocalTrackLike | null;
  op: number;
}

function errMsg(e: unknown): string {
  if (e && typeof e === "object" && "name" in e) {
    const name = String((e as { name: unknown }).name);
    if (name === "NotAllowedError" || name === "SecurityError") return "permission_denied";
    if (name === "NotFoundError" || name === "OverconstrainedError") return "device_not_found";
    if (name === "NotReadableError") return "device_busy";
  }
  return e instanceof Error ? e.message : String(e);
}

export class LocalMedia {
  private readonly adapter: CaptureAdapter;
  private room: PublishTargetLike | null = null;
  private disposed = false;
  private listeners = new Set<(s: LocalMediaSnapshot) => void>();
  private slots: Record<Kind, DeviceSlot> = {
    microphone: { intent: false, status: "off", error: null, track: null, op: 0 },
    camera: { intent: false, status: "off", error: null, track: null, op: 0 },
  };
  private screen = {
    status: "off" as DeviceStatus,
    error: null as string | null,
    tracks: [] as LocalTrackLike[],
    unsub: [] as Array<() => void>,
    op: 0,
  };
  /** Publicações ativas: track → room onde está publicada. */
  private published = new Map<LocalTrackLike, PublishTargetLike>();

  constructor(
    adapter: CaptureAdapter,
    private readonly telemetry?: RtcTelemetrySink,
  ) {
    this.adapter = adapter;
  }

  private static readonly EV = {
    microphone: { on: "MIC_ON", off: "MIC_OFF", err: "MIC_ERROR" },
    camera: { on: "CAM_ON", off: "CAM_OFF", err: "CAM_ERROR" },
  } as const;

  // ---------- estado ----------
  getSnapshot(): LocalMediaSnapshot {
    const d = (s: DeviceSlot): DeviceState => ({
      intent: s.intent,
      status: s.status,
      error: s.error,
    });
    return {
      microphone: d(this.slots.microphone),
      camera: d(this.slots.camera),
      screenShare: { status: this.screen.status, error: this.screen.error },
      roomAttached: this.room !== null,
      disposed: this.disposed,
    };
  }

  subscribe(fn: (s: LocalMediaSnapshot) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    const s = this.getSnapshot();
    for (const fn of this.listeners) fn(s);
  }

  // ---------- room ----------
  async attachRoom(room: PublishTargetLike): Promise<void> {
    if (this.disposed) return;
    if (this.room === room) return; // reconnect da mesma Room: não é troca de contexto
    if (this.room) await this.detachRoom(this.room);
    if (this.disposed) return;
    this.room = room;
    this.emit();
    const pending: Promise<void>[] = [];
    for (const k of ["microphone", "camera"] as Kind[]) {
      const t = this.slots[k].track;
      if (this.slots[k].intent && t) pending.push(this.publish(t));
    }
    await Promise.all(pending);
  }

  async detachRoom(room: PublishTargetLike): Promise<void> {
    if (this.room !== room) return;
    this.room = null;
    // Screen share não sobrevive a troca de contexto.
    this.stopScreenInternal();
    const ops: Promise<void>[] = [];
    for (const [track, r] of this.published) {
      if (r === room) ops.push(this.unpublish(track));
    }
    this.emit();
    await Promise.all(ops);
  }

  private async publish(track: LocalTrackLike): Promise<void> {
    const room = this.room;
    if (!room || this.published.get(track) === room) return;
    this.published.set(track, room);
    try {
      await room.publishTrack(track);
    } catch {
      if (this.published.get(track) === room) this.published.delete(track);
      return;
    }
    // Room trocou / track abandonada durante o await → desfaz.
    if (this.room !== room || this.published.get(track) !== room || !this.isLive(track)) {
      if (this.published.get(track) === room) this.published.delete(track);
      await room.unpublishTrack(track).catch(() => {});
      return;
    }
    // Evidência real: track local efetivamente publicada nesta Room.
    emitTelemetry(this.telemetry, "ROOM_MEDIA_ACTIVE", {
      dedupeKey: telemetryObjectKey(room),
      metadata: { trackSource: track.source, reason: "local_published" },
    });
  }

  private async unpublish(track: LocalTrackLike): Promise<void> {
    const room = this.published.get(track);
    if (!room) return;
    this.published.delete(track);
    await room.unpublishTrack(track).catch(() => {});
  }

  private isLive(track: LocalTrackLike): boolean {
    return (
      this.slots.microphone.track === track ||
      this.slots.camera.track === track ||
      this.screen.tracks.includes(track)
    );
  }

  // ---------- mic / cam ----------
  setMicrophoneEnabled(on: boolean): Promise<void> {
    return this.setDevice("microphone", on);
  }

  setCameraEnabled(on: boolean): Promise<void> {
    return this.setDevice("camera", on);
  }

  private async setDevice(kind: Kind, on: boolean): Promise<void> {
    if (this.disposed) return;
    const slot = this.slots[kind];
    const op = ++slot.op;
    if (!on) {
      const wasOn = slot.intent || slot.track !== null;
      slot.intent = false;
      slot.status = "off";
      slot.error = null;
      const t = slot.track;
      slot.track = null;
      this.emit();
      if (wasOn) emitTelemetry(this.telemetry, LocalMedia.EV[kind].off);
      if (t) {
        t.stop();
        await this.unpublish(t);
      }
      return;
    }
    slot.intent = true;
    slot.error = null;
    if (slot.track) {
      slot.status = "on";
      this.emit();
      await this.publish(slot.track);
      return;
    }
    slot.status = "starting";
    this.emit();
    let track: LocalTrackLike;
    try {
      track =
        kind === "microphone"
          ? await this.adapter.createMicrophoneTrack()
          : await this.adapter.createCameraTrack();
    } catch (e) {
      if (this.disposed || op !== slot.op) return;
      slot.intent = false;
      slot.status = "error";
      slot.error = errMsg(e);
      this.emit();
      emitTelemetry(this.telemetry, LocalMedia.EV[kind].err, {
        error: { code: slot.error, message: slot.error },
      });
      return;
    }
    if (this.disposed || op !== slot.op || !slot.intent) {
      track.stop(); // Promise atrasada: nunca publica
      return;
    }
    slot.track = track;
    slot.status = "on";
    this.emit();
    emitTelemetry(this.telemetry, LocalMedia.EV[kind].on);
    await this.publish(track);
  }

  // ---------- screen share ----------
  async startScreenShare(): Promise<void> {
    if (this.disposed || this.screen.status === "on" || this.screen.status === "starting") return;
    const op = ++this.screen.op;
    this.screen.status = "starting";
    this.screen.error = null;
    this.emit();
    let tracks: LocalTrackLike[];
    try {
      tracks = await this.adapter.createScreenTracks();
    } catch (e) {
      if (this.disposed || op !== this.screen.op) return;
      this.screen.status = "error";
      this.screen.error = errMsg(e);
      this.emit();
      emitTelemetry(this.telemetry, "SCREEN_SHARE_OFF", {
        error: { code: this.screen.error, message: this.screen.error },
      });
      return;
    }
    if (this.disposed || op !== this.screen.op || !this.room) {
      for (const t of tracks) t.stop();
      if (!this.disposed && op === this.screen.op) {
        this.screen.status = "off";
        this.emit();
      }
      return;
    }
    this.screen.tracks = tracks;
    this.screen.unsub = tracks.map((t) => t.onEnded(() => this.stopScreenShare()));
    this.screen.status = "on";
    this.emit();
    emitTelemetry(this.telemetry, "SCREEN_SHARE_ON");
    await Promise.all(tracks.map((t) => this.publish(t)));
  }

  async stopScreenShare(): Promise<void> {
    const tracks = this.stopScreenInternal();
    this.emit();
    await Promise.all(tracks.map((t) => this.unpublish(t)));
  }

  private stopScreenInternal(): LocalTrackLike[] {
    this.screen.op++;
    const tracks = this.screen.tracks;
    if (tracks.length > 0) emitTelemetry(this.telemetry, "SCREEN_SHARE_OFF");
    for (const u of this.screen.unsub) u();
    this.screen.unsub = [];
    this.screen.tracks = [];
    for (const t of tracks) t.stop();
    this.screen.status = "off";
    this.screen.error = null;
    // despublicação da Room atual é feita por quem chamou (ou por detachRoom)
    for (const t of tracks) {
      const r = this.published.get(t);
      if (r) {
        this.published.delete(t);
        void r.unpublishTrack(t).catch(() => {});
      }
    }
    return [];
  }

  // ---------- dispose ----------
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.stopScreenInternal();
    const ops: Promise<void>[] = [];
    for (const k of ["microphone", "camera"] as Kind[]) {
      const s = this.slots[k];
      s.op++;
      s.intent = false;
      s.status = "off";
      s.error = null;
      if (s.track) {
        s.track.stop();
        ops.push(this.unpublish(s.track));
        s.track = null;
      }
    }
    for (const t of [...this.published.keys()]) ops.push(this.unpublish(t));
    this.room = null;
    this.emit();
    this.listeners.clear();
    await Promise.all(ops);
  }
}

// ---------- adapter real (livekit-client), carregado sob demanda ----------

/** Adapter de captura real. Configurações preservadas do RTC v1. */
export function createLiveKitCaptureAdapter(): CaptureAdapter {
  const wrap = (
    t: {
      stop(): void;
      mediaStreamTrack: MediaStreamTrack;
    },
    source: LocalSource,
  ): LocalTrackLike & { raw: unknown } => ({
    raw: t,
    source,
    stop: () => t.stop(),
    onEnded: (fn) => {
      const h = () => fn();
      t.mediaStreamTrack.addEventListener("ended", h);
      return () => t.mediaStreamTrack.removeEventListener("ended", h);
    },
  });
  return {
    async createMicrophoneTrack() {
      const lk = await import("livekit-client");
      const t = await lk.createLocalAudioTrack({
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
        sampleRate: 48000,
      });
      return wrap(t, "microphone");
    },
    async createCameraTrack() {
      const lk = await import("livekit-client");
      const t = await lk.createLocalVideoTrack({
        resolution: { width: 640, height: 360, frameRate: 15 },
      });
      return wrap(t, "camera");
    },
    async createScreenTracks() {
      const lk = await import("livekit-client");
      const ts = await lk.createLocalScreenTracks({ audio: true });
      return ts.map((t) => wrap(t, t.kind === "audio" ? "screen_share_audio" : "screen_share"));
    },
  };
}
