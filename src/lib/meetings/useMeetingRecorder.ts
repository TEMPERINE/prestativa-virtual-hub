import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rpc = (supabase as any).rpc.bind(supabase) as (
  fn: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: unknown }>;

type Args = {
  /** Track de áudio local da call (mic). */
  getLocalAudioTrack: () => MediaStreamTrack | null;
  /** Streams remotas (uma por peer). Usamos os audio tracks. */
  remoteStreams: Record<string, MediaStream>;
};

export type RecorderState = {
  isRecording: boolean;
  isUploading: boolean;
  elapsedSeconds: number;
  start: (meetingId: string) => Promise<void>;
  stop: () => Promise<void>;
};

/**
 * Gravação estilo Loom: captura **tela + áudio** via `getDisplayMedia`
 * e mixa com o microfone local + áudio dos peers via Web Audio API.
 * Resultado: arquivo `video/webm` enviado pro bucket privado
 * `meeting-recordings` no path `<meeting_id>/<timestamp>.webm`.
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
  const ownedMicStreamRef = useRef<MediaStream | null>(null);
  const displayStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamsRef = useRef(remoteStreams);
  remoteStreamsRef.current = remoteStreams;

  // Reconecta peers remotos no mix enquanto gravando.
  useEffect(() => {
    if (!isRecording) return;
    const ctx = audioCtxRef.current;
    const dest = destinationRef.current;
    if (!ctx || !dest) return;
    const current = new Set(Object.values(remoteStreams));
    for (const [stream, source] of sourcesRef.current) {
      if (!current.has(stream) && stream !== ownedMicStreamRef.current && stream !== displayStreamRef.current) {
        try { source.disconnect(); } catch { /* noop */ }
        sourcesRef.current.delete(stream);
      }
    }
    for (const stream of current) {
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
    if (displayStreamRef.current) {
      displayStreamRef.current.getTracks().forEach((t) => { try { t.stop(); } catch { /* noop */ } });
      displayStreamRef.current = null;
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

  const start = useCallback(async (meetingId: string) => {
    if (isRecording) return;

    // 1) Captura de tela.
    //    - No app desktop (Electron), usamos `window.prestativaDesktop.getScreenStream()`
    //      exposto via preload — captura a janela do app sem nenhum diálogo.
    //    - No navegador, caímos no `getDisplayMedia` com `preferCurrentTab` (o próprio
    //      diálogo "Compartilhar esta aba?" funciona como confirmação de gravação).
    let displayStream: MediaStream;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const desktop = (window as any).prestativaDesktop as
      | { getScreenStream?: () => Promise<MediaStream> }
      | undefined;
    try {
      if (desktop?.getScreenStream) {
        displayStream = await desktop.getScreenStream();
      } else {
        displayStream = await navigator.mediaDevices.getDisplayMedia({
          video: { frameRate: 15 },
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          },
          preferCurrentTab: true,
          systemAudio: "include",
          selfBrowserSurface: "include",
          surfaceSwitching: "exclude",
        } as unknown as DisplayMediaStreamOptions);
      }
    } catch (err) {
      const name = (err as { name?: string })?.name;
      if (name === "NotAllowedError") {
        toast.error("Você precisa confirmar para gravar a reunião.");
      } else {
        console.error("[recorder] getDisplayMedia error:", err);
        toast.error("Não foi possível capturar a tela.");
      }
      return;
    }

    displayStreamRef.current = displayStream;

    // Se o usuário parar pela barra nativa do navegador, finalizamos.
    const videoTrack = displayStream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.addEventListener("ended", () => {
        if (recorderRef.current && recorderRef.current.state !== "inactive") {
          void stopRef.current?.();
        }
      });
    }

    // 2) Mic — usa o track da call se utilizável; senão pede um dedicado.
    const callTrack = getLocalAudioTrack();
    const usableCallTrack = callTrack && callTrack.enabled && callTrack.readyState === "live"
      ? callTrack
      : null;
    let ownedMic: MediaStream | null = null;
    if (!usableCallTrack) {
      try {
        ownedMic = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
        ownedMicStreamRef.current = ownedMic;
      } catch (err) {
        console.warn("[recorder] sem mic dedicado:", err);
      }
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const AudioCtor: typeof AudioContext = (window as any).AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioCtor();
      audioCtxRef.current = ctx;
      if (ctx.state === "suspended") {
        try { await ctx.resume(); } catch { /* noop */ }
      }
      const dest = ctx.createMediaStreamDestination();
      destinationRef.current = dest;

      // Áudio do sistema (vem do displayStream se o usuário marcou "compartilhar áudio").
      if (displayStream.getAudioTracks().length > 0) {
        try {
          const src = ctx.createMediaStreamSource(new MediaStream(displayStream.getAudioTracks()));
          src.connect(dest);
          sourcesRef.current.set(displayStream, src);
        } catch (err) {
          console.warn("[recorder] não conectou áudio do sistema:", err);
        }
      }
      // Mic
      if (usableCallTrack) {
        const ms = new MediaStream([usableCallTrack]);
        const src = ctx.createMediaStreamSource(ms);
        src.connect(dest);
        sourcesRef.current.set(ms, src);
      } else if (ownedMic && ownedMic.getAudioTracks().length > 0) {
        const src = ctx.createMediaStreamSource(ownedMic);
        src.connect(dest);
        sourcesRef.current.set(ownedMic, src);
      }
      // Peers
      for (const stream of Object.values(remoteStreamsRef.current)) {
        if (stream.getAudioTracks().length === 0) continue;
        try {
          const src = ctx.createMediaStreamSource(stream);
          src.connect(dest);
          sourcesRef.current.set(stream, src);
        } catch { /* noop */ }
      }

      // Monta o stream final: vídeo da tela + áudio mixado.
      const finalStream = new MediaStream();
      displayStream.getVideoTracks().forEach((t) => finalStream.addTrack(t));
      dest.stream.getAudioTracks().forEach((t) => finalStream.addTrack(t));

      const mime = pickMime();
      const recorder = new MediaRecorder(
        finalStream,
        mime
          ? { mimeType: mime, videoBitsPerSecond: 1_500_000, audioBitsPerSecond: 96_000 }
          : { videoBitsPerSecond: 1_500_000, audioBitsPerSecond: 96_000 },
      );
      recorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.start(2000);
      meetingIdRef.current = meetingId;
      startedAtRef.current = Date.now();
      setIsRecording(true);
      // Marca a reunião como gravada para aparecer no histórico
      rpc("meeting_mark_recording_started", { _meeting_id: meetingId }).catch((e) => {
        console.warn("[recorder] mark_recording_started failed", e);
      });
      tickRef.current = window.setInterval(() => {
        setElapsedSeconds(Math.floor((Date.now() - startedAtRef.current) / 1000));
      }, 1000);
      toast.success("🔴 Gravando tela + áudio…");

    } catch (err) {
      console.error("[recorder] start error:", err);
      toast.error("Não foi possível iniciar a gravação.");
      cleanup();
    }
  }, [isRecording, getLocalAudioTrack, cleanup]);

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

    const stopped = new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
    });
    try { recorder.stop(); } catch { /* noop */ }
    await stopped;

    const mime = recorder.mimeType || "video/webm";
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

  // Workaround: o handler "ended" do videoTrack precisa chamar a versão atual de stop.
  const stopRef = useRef<typeof stop | null>(null);
  stopRef.current = stop;

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
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm;codecs=h264,opus",
    "video/webm",
    "video/mp4",
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
