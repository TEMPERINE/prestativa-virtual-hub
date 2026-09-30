import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { startServerRecording, stopServerRecording } from "./egress.functions";
import type { RecorderState } from "./useMeetingRecorder";

/**
 * RTC V2 — gravação server-side (LiveKit Egress). Sem getDisplayMedia,
 * sem MediaRecorder. Estado vem de meeting_egress (realtime), então
 * reflete o Egress real mesmo se outra pessoa iniciou/parou.
 * Falhas aqui nunca tocam a Room/mídia.
 */
export function useServerRecorder(opts: {
  meetingId: string | null;
  isRoomConnected: () => boolean;
}): RecorderState {
  const startFn = useServerFn(startServerRecording);
  const stopFn = useServerFn(stopServerRecording);
  const [active, setActive] = useState<{ startedAt: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const meetingRef = useRef<string | null>(null);

  const refresh = useCallback(async (meetingId: string | null) => {
    if (!meetingId) return setActive(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase as any)
      .from("meeting_egress")
      .select("status, started_at, created_at")
      .eq("meeting_id", meetingId)
      .in("status", ["starting", "active", "ending"])
      .maybeSingle();
    setActive(data ? { startedAt: Date.parse(data.started_at ?? data.created_at) } : null);
  }, []);

  useEffect(() => {
    const id = opts.meetingId;
    meetingRef.current = id;
    void refresh(id);
    if (!id) return;
    const ch = supabase
      .channel(`meeting-egress:${id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "meeting_egress", filter: `meeting_id=eq.${id}` },
        () => void refresh(id),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [opts.meetingId, refresh]);

  useEffect(() => {
    if (!active) return setElapsed(0);
    const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - active.startedAt) / 1000)));
    tick();
    const t = window.setInterval(tick, 1000);
    return () => window.clearInterval(t);
  }, [active]);

  const start = useCallback(
    async (meetingId: string) => {
      if (!opts.isRoomConnected()) {
        toast.error("Aguarde a conexão da sala antes de gravar.");
        return;
      }
      setBusy(true);
      try {
        const r = await startFn({ data: { meetingId } });
        if (r.ok) {
          toast.success("Gravação iniciada");
          meetingRef.current = meetingId;
          await refresh(meetingId);
          return;
        }
        const msg: Record<string, string> = {
          STORAGE_NOT_CONFIGURED: "Gravação ainda não configurada pelo administrador.",
          ALREADY_RECORDING: "Esta reunião já está sendo gravada.",
          NOT_CONNECTED: "Você não está conectado à sala.",
          NOT_PARTICIPANT: "Você não participa desta reunião.",
        };
        toast.error(msg[r.code] ?? "Não foi possível iniciar a gravação.");
      } catch {
        toast.error("Não foi possível iniciar a gravação.");
      } finally {
        setBusy(false);
      }
    },
    [opts, startFn, refresh],
  );

  const stop = useCallback(async () => {
    const id = meetingRef.current;
    if (!id) return;
    setBusy(true);
    try {
      await stopFn({ data: { meetingId: id } });
      toast.message("Finalizando gravação…");
    } catch {
      toast.error("Não foi possível parar a gravação.");
    } finally {
      setBusy(false);
      void refresh(id);
    }
  }, [stopFn, refresh]);

  return { isRecording: !!active, isUploading: busy, elapsedSeconds: elapsed, start, stop };
}
