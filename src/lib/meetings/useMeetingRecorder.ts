import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rpc = (supabase as any).rpc.bind(supabase) as (
  fn: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: unknown }>;

type Args = {
  /** Função que retorna o track local de áudio (mic). */
  getLocalAudioTrack: () => MediaStreamTrack | null;
  /** Streams remotas (uma por peer). Vamos usar os audio tracks dela. */
  remoteStreams: Record<string, MediaStream>;
};

export type RecorderState = {
  isRecording: boolean;
  isUploading: boolean;
  /** Segundos desde o início. Útil para mostrar timer. */
  elapsedSeconds: number;
  start: (meetingId: string) => Promise<void>;
  stop: () => Promise<void>;
};

/**
 * Gravação client-side, manual (botão). Mixa o microfone local + áudio de
 * todos os peers via Web Audio API e empacota em audio/webm (Opus).
 *
 * O arquivo é enviado pro bucket privado `meeting-recordings` no path
 * `<meeting_id>/<timestamp>.webm`. As RLS no storage garantem que só
 * participantes da reunião conseguem ler/enviar.
 */
export function useMeetingRecorder({ getLocalAudioTrack, remoteStreams }: Args) {
  const [isRecording, setIsRecording] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const destinationRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const sourcesRef = useRef<Map<MediaStream, MediaStreamAudioSourceNode>>(new Map());
  const meetingIdRef = useRef<string | null>(null);
  const startedAtRef = useRef<number>(0);
  const tickRef = useRef<number | null>(null);

  // Reconecta peers remotos no mix enquanto gravando (entram/saem da call).
  useEffect(() => {
    if (!isRecording) return;
    const ctx = audioCtxRef.current;
    const dest = destinationRef.current;
    if (!ctx || !dest) return;

    const currentStreams = new Set(Object.values(remoteStreams));
    // Remove peers que saíram
    for (const [stream, source] of sourcesRef.current) {
      if (!currentStreams.has(stream)) {
        try { source.disconnect(); } catch { /* noop */ }
        sourcesRef.current.delete(stream);
      }
    }
    // Adiciona peers novos
    for (const stream of currentStreams) {
      if (sourcesRef.current.has(stream)) continue;
      if (stream.getAudioTracks().length === 0) continue;
      try {
        const src = ctx.createMediaStreamSource(stream);
        src.connect(dest);
        sourcesRef.current.set(stream, src);
      } catch (err) {
        console.warn("[recorder] não foi possível conectar peer ao mix:", err);
      }
    }
  }, [isRecording, remoteStreams]);

  const cleanup = useCallback(() => {
    if (tickRef.current) {
      window.clearInterval(tickRef.current);
      tickRef.current = null;
    }
    for (const [, src] of sourcesRef.current) {
      try { src.disconnect(); } catch { /* noop */ }
    }
    sourcesRef.current.clear();
    if (ownedMicStreamRef.current) {
      ownedMicStreamRef.current.getTracks().forEach((t) => { try { t.stop(); } catch { /* noop */ } });
      ownedMicStreamRef.current = null;
    }
    if (audioCtxRef.current) {
      void audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    destinationRef.current = null;
    recorderRef.current = null;
    chunksRef.current = [];
    setElapsedSeconds(0);
  }, []);

  const ownedMicStreamRef = useRef<MediaStream | null>(null);

  const start = useCallback(async (meetingId: string) => {
    if (isRecording) return;
    const callTrack = getLocalAudioTrack();
    // Track da call serve só se existir E estiver habilitado (não mutado).
    const usableCallTrack = callTrack && callTrack.enabled && callTrack.readyState === "live"
      ? callTrack
      : null;

    // Se não houver mic utilizável da call, peça um stream dedicado para
    // a gravação. Mantém isso dentro do gesto do usuário (clique → handler).
    let ownedMic: MediaStream | null = null;
    if (!usableCallTrack) {
      try {
        ownedMic = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
        ownedMicStreamRef.current = ownedMic;
      } catch (err) {
        console.warn("[recorder] sem mic dedicado:", err);
        if (Object.keys(remoteStreams).length === 0) {
          toast.error("Permissão de microfone negada. Habilite o mic e tente de novo.");
          return;
        }
      }
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const AudioCtor: typeof AudioContext = (window as any).AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioCtor();
      audioCtxRef.current = ctx;
      // resume() é necessário em alguns browsers quando o contexto nasce suspenso.
      if (ctx.state === "suspended") {
        try { await ctx.resume(); } catch { /* noop */ }
      }
      const dest = ctx.createMediaStreamDestination();
      destinationRef.current = dest;

      // Mic local (preferência: track da call → senão stream dedicado)
      if (usableCallTrack) {
        const localStream = new MediaStream([usableCallTrack]);
        const src = ctx.createMediaStreamSource(localStream);
        src.connect(dest);
        sourcesRef.current.set(localStream, src);
      } else if (ownedMic && ownedMic.getAudioTracks().length > 0) {
        const src = ctx.createMediaStreamSource(ownedMic);
        src.connect(dest);
        sourcesRef.current.set(ownedMic, src);
      }
      // Peers
      for (const stream of Object.values(remoteStreams)) {
        if (stream.getAudioTracks().length === 0) continue;
        const src = ctx.createMediaStreamSource(stream);
        src.connect(dest);
        sourcesRef.current.set(stream, src);
      }

      const mime = pickMime();
      const recorder = new MediaRecorder(dest.stream, mime ? { mimeType: mime, audioBitsPerSecond: 96000 } : { audioBitsPerSecond: 96000 });
      recorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.start(2000); // flush a cada 2s
      meetingIdRef.current = meetingId;
      startedAtRef.current = Date.now();
      setIsRecording(true);
      tickRef.current = window.setInterval(() => {
        setElapsedSeconds(Math.floor((Date.now() - startedAtRef.current) / 1000));
      }, 1000);
      toast.success("🎙️ Gravando reunião…");
    } catch (err) {
      console.error("[recorder] start error:", err);
      toast.error("Não foi possível iniciar a gravação.");
      cleanup();
    }
  }, [isRecording, getLocalAudioTrack, remoteStreams, cleanup]);

  const stop = useCallback(async () => {
    const recorder = recorderRef.current;
    const meetingId = meetingIdRef.current;
    if (!recorder || !meetingId) {
      cleanup();
      setIsRecording(false);
      return;
    }
    setIsRecording(false);
    setIsUploading(true);
    const durationSec = Math.max(1, Math.floor((Date.now() - startedAtRef.current) / 1000));

    // Aguarda último dataavailable
    const stopped = new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
    });
    try { recorder.stop(); } catch { /* noop */ }
    await stopped;

    const mime = recorder.mimeType || "audio/webm";
    const blob = new Blob(chunksRef.current, { type: mime });
    cleanup();

    try {
      const filename = `${Date.now()}.webm`;
      const path = `${meetingId}/${filename}`;
      const { error: upErr } = await supabase.storage
        .from("meeting-recordings")
        .upload(path, blob, { contentType: mime, upsert: false });
      if (upErr) throw upErr;

      const { error: rpcErr } = await rpc("meeting_set_recording", {
        _meeting_id: meetingId,
        _path: path,
        _duration_seconds: durationSec,
      });
      if (rpcErr) throw rpcErr;

      toast.success(`✅ Gravação salva (${formatDuration(durationSec)})`);
    } catch (err) {
      console.error("[recorder] upload error:", err);
      toast.error("Falha ao enviar a gravação. Tente novamente.");
    } finally {
      setIsUploading(false);
      meetingIdRef.current = null;
    }
  }, [cleanup]);

  // Para gravação ao desmontar
  useEffect(() => {
    return () => {
      if (recorderRef.current && recorderRef.current.state !== "inactive") {
        try { recorderRef.current.stop(); } catch { /* noop */ }
      }
      cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { isRecording, isUploading, elapsedSeconds, start, stop } satisfies RecorderState;
}

function pickMime(): string | null {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
  ];
  if (typeof MediaRecorder === "undefined") return null;
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported(c)) return c;
  }
  return null;
}

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
