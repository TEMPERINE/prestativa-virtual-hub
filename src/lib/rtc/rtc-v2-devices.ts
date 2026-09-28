/**
 * RTC v2 — Etapa 12: adaptador de dispositivos + captura real (livekit-client).
 *
 * - Nunca pede permissão sozinho: enumerate() só lista; captura acontece apenas
 *   quando o LocalMedia recebe uma ação explícita (toggle).
 * - Os deviceIds selecionados são lidos no momento da captura.
 * - Configurações de áudio/vídeo idênticas ao RTC v1.
 */
import type { CaptureAdapter, LocalSource, LocalTrackLike } from "./local-media";

export const V2_AUDIO_CAPTURE = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  channelCount: 1,
  sampleRate: 48000,
  sampleSize: 16,
} as const;

export const V2_VIDEO_CAPTURE = {
  resolution: { width: 640, height: 360, frameRate: 15 },
} as const;

/** Track local do V2: expõe a track LiveKit (para publicar) e a MediaStreamTrack (para UI). */
export interface V2LocalTrack extends LocalTrackLike {
  readonly lk: unknown;
  readonly mediaStreamTrack: MediaStreamTrack;
}

export function isV2LocalTrack(t: LocalTrackLike | null | undefined): t is V2LocalTrack {
  return !!t && "mediaStreamTrack" in t && "lk" in t;
}

export interface DeviceSelection {
  audioInput: string | null;
  videoInput: string | null;
}

type LkLocalTrack = { stop(): void; mediaStreamTrack: MediaStreamTrack; kind?: string };

function wrap(t: LkLocalTrack, source: LocalSource): V2LocalTrack {
  return {
    lk: t,
    mediaStreamTrack: t.mediaStreamTrack,
    source,
    stop: () => t.stop(),
    onEnded: (fn) => {
      const h = () => fn();
      t.mediaStreamTrack.addEventListener("ended", h);
      return () => t.mediaStreamTrack.removeEventListener("ended", h);
    },
  };
}

/** Adapter de captura real. `getSelection` é lido a cada captura. */
export function createV2CaptureAdapter(getSelection: () => DeviceSelection): CaptureAdapter {
  return {
    async createMicrophoneTrack() {
      const lk = await import("livekit-client");
      const id = getSelection().audioInput;
      try {
        return wrap(
          await lk.createLocalAudioTrack(id ? { ...V2_AUDIO_CAPTURE, deviceId: { ideal: id } } : V2_AUDIO_CAPTURE),
          "microphone",
        );
      } catch (e) {
        if ((e as { name?: string })?.name === "OverconstrainedError") {
          return wrap(await lk.createLocalAudioTrack({}), "microphone");
        }
        throw e;
      }
    },
    async createCameraTrack() {
      const lk = await import("livekit-client");
      const id = getSelection().videoInput;
      try {
        return wrap(
          await lk.createLocalVideoTrack(id ? { ...V2_VIDEO_CAPTURE, deviceId: { ideal: id } } : V2_VIDEO_CAPTURE),
          "camera",
        );
      } catch (e) {
        if ((e as { name?: string })?.name === "OverconstrainedError") {
          return wrap(await lk.createLocalVideoTrack({}), "camera");
        }
        throw e;
      }
    },
    async createScreenTracks() {
      const lk = await import("livekit-client");
      const ts = await lk.createLocalScreenTracks({ audio: true });
      return ts.map((t) => wrap(t, t.kind === "audio" ? "screen_share_audio" : "screen_share"));
    },
  };
}

/** Lista de dispositivos sem pedir permissão. */
export async function enumerateV2Devices(): Promise<{
  video: MediaDeviceInfo[];
  audioInput: MediaDeviceInfo[];
  audioOutput: MediaDeviceInfo[];
}> {
  try {
    const list = await navigator.mediaDevices.enumerateDevices();
    return {
      video: list.filter((d) => d.kind === "videoinput"),
      audioInput: list.filter((d) => d.kind === "audioinput"),
      audioOutput: list.filter((d) => d.kind === "audiooutput"),
    };
  } catch {
    return { video: [], audioInput: [], audioOutput: [] };
  }
}
