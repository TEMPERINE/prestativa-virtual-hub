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
//  - Mic (Privacy Fase 2): OFF = mute oficial com stopOnMute (LiveKit para a
//    MediaStreamTrack → indicador do navegador apaga); ON = unmute da MESMA
//    track/publicação, que readquire o device selecionado. `voluntaryStop`
//    distingue essa parada voluntária de perda real do dispositivo.
//    (Histórico 14B: ON = unmute da MESMA track/publicação.) Nova captura só quando
//    não há track válida (nunca houve, ended, falhou). Troca de dispositivo usa
//    o lifecycle da própria track (setDevice), sem unpublish/recreate.
//  - Cam = OFF = unpublish + stop da captura;
//  - erro de captura → status "error", intent OFF, sem retry automático;
//  - dispose() para tudo e invalida Promises pendentes.
//
// Não ligado ao produto. RTC v1 (useLiveKit.ts) permanece intocado.

import { emitTelemetry, telemetryObjectKey, type RtcTelemetrySink } from "./rtc-telemetry-types";

export type LocalSource = "microphone" | "camera" | "screen_share" | "screen_share_audio";

/** Track local mínima. */
export interface LocalTrackLike {
  readonly source: LocalSource;
  stop(): void;
  /** Dispara quando a captura termina fora do nosso controle (ex.: "Parar compartilhamento"). Retorna unsubscribe. */
  onEnded(fn: () => void): () => void;
  /** Mute oficial (LiveKit): sem envio de áudio, captura/publicação preservadas. */
  mute?(): Promise<void>;
  unmute?(): Promise<void>;
  /** true se a captura subjacente terminou (MediaStreamTrack ended). */
  isEnded?(): boolean;
  /** Troca a fonte preservando track/publicação/sender. Retorna se o device real confere. */
  setDevice?(deviceId: string): Promise<boolean>;
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
  endedUnsub: (() => void) | null;
  /** true enquanto a captura está parada por OFF voluntário (mute+stopOnMute). */
  voluntaryStop: boolean;
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
    microphone: { intent: false, status: "off", error: null, track: null, op: 0, endedUnsub: null, voluntaryStop: false },
    camera: { intent: false, status: "off", error: null, track: null, op: 0, endedUnsub: null, voluntaryStop: false },
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

  /** Leitura da track local já capturada (nunca captura). */
  getTrack(kind: "microphone" | "camera" | "screen_share"): LocalTrackLike | null {
    if (kind === "screen_share")
      return this.screen.tracks.find((t) => t.source === "screen_share") ?? null;
    return this.slots[kind].track;
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

  /** Mic usa mute/unmute quando a track suporta; câmera mantém stop/recreate. */
  private canMute(
    kind: Kind,
    t: LocalTrackLike | null,
  ): t is LocalTrackLike & {
    mute(): Promise<void>;
    unmute(): Promise<void>;
  } {
    return (
      kind === "microphone" && !!t && typeof t.mute === "function" && typeof t.unmute === "function"
    );
  }

  private trackValid(t: LocalTrackLike | null, slot?: DeviceSlot): boolean {
    if (!t) return false;
    // Parada voluntária: MediaStreamTrack "ended" é esperado; unmute readquire.
    if (slot && slot.track === t && slot.voluntaryStop) return true;
    return !(t.isEnded?.() ?? false);
  }

  /** Descarta a track do slot: stop + unpublish, sem referências antigas. */
  private async dropTrack(slot: DeviceSlot): Promise<void> {
    const t = slot.track;
    slot.track = null;
    slot.endedUnsub?.();
    slot.endedUnsub = null;
    slot.voluntaryStop = false;
    if (t) {
      t.stop();
      await this.unpublish(t);
    }
  }

  // ---------- RTC On Demand: captura suspensa sem audiência ----------
  private suspended = false;

  isCaptureSuspended(): boolean {
    return this.suspended;
  }

  /**
   * Para a captura física de mic/câmera (sem audiência), preservando intent,
   * dispositivo selecionado e sem tocar em screen share.
   */
  async suspendCapture(): Promise<void> {
    if (this.disposed || this.suspended) return;
    this.suspended = true;
    const ops: Promise<void>[] = [];
    for (const k of ["microphone", "camera"] as Kind[]) {
      const slot = this.slots[k];
      slot.op++;
      if (slot.status !== "error") slot.status = "off";
      ops.push(this.dropTrack(slot));
    }
    this.emit();
    await Promise.all(ops);
  }

  /** Restaura via lifecycle normal os intents que estavam ON. */
  async resumeCapture(): Promise<void> {
    if (this.disposed || !this.suspended) return;
    this.suspended = false;
    this.emit();
    await Promise.all(
      (["microphone", "camera"] as Kind[])
        .filter((k) => this.slots[k].intent)
        .map((k) => this.setDevice(k, true)),
    );
  }

  private async setDevice(kind: Kind, on: boolean): Promise<void> {
    if (this.disposed) return;
    const slot = this.slots[kind];
    const op = ++slot.op;
    if (on && this.suspended) {
      // Sem audiência: registra a intenção; captura acontece no resume.
      slot.intent = true;
      slot.error = null;
      this.emit();
      return;
    }
    if (!on) {
      const wasOn = slot.intent || (slot.track !== null && slot.status !== "off");
      slot.intent = false;
      slot.status = "off";
      slot.error = null;
      const t = slot.track;
      if (this.canMute(kind, t) && this.trackValid(t, slot)) {
        // Mute oficial + stopOnMute: captura parada, publicação preservada.
        // Marca ANTES do await: um "ended" durante o mute não é perda de device.
        slot.voluntaryStop = true;
        this.emit();
        if (wasOn) emitTelemetry(this.telemetry, LocalMedia.EV[kind].off);
        try {
          await t.mute();
        } catch {
          // mute falhou: garante privacidade descartando a captura.
          if (slot.track === t) await this.dropTrack(slot);
        }
        return;
      }
      this.emit();
      if (wasOn) emitTelemetry(this.telemetry, LocalMedia.EV[kind].off);
      await this.dropTrack(slot);
      return;
    }
    slot.intent = true;
    slot.error = null;
    if (slot.track && !this.trackValid(slot.track, slot)) await this.dropTrack(slot);
    if (this.disposed || op !== slot.op || !slot.intent) return;
    if (slot.track) {
      const t = slot.track;
      const wasOff = slot.status !== "on";
      slot.status = "on";
      this.emit();
      if (this.canMute(kind, t)) {
        try {
          await t.unmute();
        } catch (e) {
          if (this.disposed || op !== slot.op) return;
          await this.failDevice(kind, slot, e);
          return;
        }
        if (this.disposed || op !== slot.op || !slot.intent) return;
        slot.voluntaryStop = false;
        // Nova MediaStreamTrack após reaquisição → UI (VU meter) religa.
        this.emit();
        if (wasOff) emitTelemetry(this.telemetry, LocalMedia.EV[kind].on);
      }
      await this.publish(t);
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
      await this.failDevice(kind, slot, e);
      return;
    }
    if (this.disposed || op !== slot.op || !slot.intent) {
      track.stop(); // Promise atrasada: nunca publica
      return;
    }
    slot.track = track;
    if (kind === "microphone") {
      slot.endedUnsub = track.onEnded(() => void this.onTrackEnded(kind, track));
    }
    slot.status = "on";
    this.emit();
    emitTelemetry(this.telemetry, LocalMedia.EV[kind].on);
    await this.publish(track);
  }

  private async failDevice(kind: Kind, slot: DeviceSlot, e: unknown): Promise<void> {
    slot.intent = false;
    slot.status = "error";
    slot.error = errMsg(e);
    const msg = slot.error;
    await this.dropTrack(slot);
    this.emit();
    emitTelemetry(this.telemetry, LocalMedia.EV[kind].err, {
      error: { code: msg, message: msg },
    });
  }

  /** Captura terminou fora do nosso controle: descarta; próximo ON readquire. */
  private async onTrackEnded(kind: Kind, track: LocalTrackLike): Promise<void> {
    const slot = this.slots[kind];
    if (this.disposed || slot.track !== track) return;
    // Parada voluntária (OFF) não é falha de hardware: mantém track/publicação.
    if (slot.voluntaryStop || !slot.intent) return;
    slot.op++;
    const wasOn = slot.intent;
    await this.dropTrack(slot);
    if (wasOn) {
      await this.failDevice(kind, slot, new Error("track_ended"));
    } else {
      this.emit();
    }
  }

  /**
   * Troca o dispositivo de entrada do mic preservando track/publicação/sender.
   * Sem track: nada a fazer (o adapter usa a seleção na próxima captura).
   * Sem suporte a setDevice: fallback para recaptura explícita.
   */
  async setMicrophoneDevice(deviceId: string): Promise<void> {
    if (this.disposed) return;
    const slot = this.slots.microphone;
    const t = slot.track;
    if (!t || !this.trackValid(t, slot)) {
      if (t) await this.dropTrack(slot);
      if (slot.intent) {
        slot.intent = false;
        await this.setDevice("microphone", true);
      }
      return;
    }
    if (typeof t.setDevice !== "function") {
      if (!slot.intent) {
        await this.dropTrack(slot);
        return;
      }
      await this.dropTrack(slot);
      slot.intent = false;
      await this.setDevice("microphone", true);
      return;
    }
    const op = slot.op;
    try {
      await t.setDevice(deviceId);
    } catch (e) {
      if (this.disposed || op !== slot.op || slot.track !== t) return;
      await this.failDevice("microphone", slot, e);
    }
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
      if (s.track) ops.push(this.dropTrack(s));
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
