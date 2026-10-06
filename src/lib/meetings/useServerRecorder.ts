import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { reconcileMeetingRecording, startServerRecording, stopServerRecording } from "./egress.functions";
import type { RecorderState } from "./useMeetingRecorder";

/**
 * RTC V2 — gravação server-side (LiveKit Egress). Sem captura de tela local,
 * sem gravador no navegador. Estado vem de meeting_egress (realtime), então
 * reflete o Egress real mesmo se outra pessoa iniciou/parou.
 * Falhas aqui nunca tocam a Room/mídia.
 */
export type ServerRecorderState = RecorderState & {
  /** Gravação recém-concluída iniciada por mim — para pedir um nome. Nunca bloqueia nada. */
  completed: { meetingId: string } | null;
  dismissCompleted: () => void;
};

export function useServerRecorder(opts: {
  meetingId: string | null;
  isRoomConnected: () => boolean;
}): ServerRecorderState {
  const startFn = useServerFn(startServerRecording);
  const stopFn = useServerFn(stopServerRecording);
  const [active, setActive] = useState<{ startedAt: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [completed, setCompleted] = useState<{ meetingId: string } | null>(null);
  const meetingRef = useRef<string | null>(null);
  /** Egress que EU iniciei e vi rodando nesta sessão — só esses geram o pedido de nome. */
  const mineRef = useRef<Set<string>>(new Set());
  const askedRef = useRef<Set<string>>(new Set());
  const reconciledRef = useRef<Set<string>>(new Set());
  const reconcileFn = useServerFn(reconcileMeetingRecording);
  const uidRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void supabase.auth.getUser().then(({ data }) => {
      if (!cancelled) uidRef.current = data.user?.id ?? null;
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const refresh = useCallback(async (meetingId: string | null) => {
    if (!meetingId) return setActive(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: rows } = await (supabase as any)
      .from("meeting_egress")
      .select("id, status, started_by, started_at, created_at")
      .eq("meeting_id", meetingId)
      .order("created_at", { ascending: false })
      .limit(5);

    const list = (rows ?? []) as Array<{
      id: string;
      status: string;
      started_by: string | null;
      started_at: string | null;
      created_at: string;
    }>;

    const running = list.find((r) => ["starting", "active", "ending"].includes(r.status));
    setActive(running ? { startedAt: Date.parse(running.started_at ?? running.created_at) } : null);
    // Reconciliação pontual (uma vez por gravação): servidor só consulta o LiveKit se o estado estiver velho.
    if (running && !reconciledRef.current.has(running.id)) {
      reconciledRef.current.add(running.id);
      void reconcileFn({ data: { meetingId } }).catch(() => {});
    }

    for (const r of list) {
      if (r.started_by && r.started_by === uidRef.current) {
        if (["starting", "active", "ending"].includes(r.status)) mineRef.current.add(r.id);
        if (r.status === "complete" && mineRef.current.has(r.id) && !askedRef.current.has(r.id)) {
          askedRef.current.add(r.id);
          setCompleted({ meetingId });
        }
      }
    }
  }, []);

  const dismissCompleted = useCallback(() => setCompleted(null), []);

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
          NOT_ALLOWED_TO_RECORD: "Seu perfil não permite iniciar gravações.",
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

  return {
    isRecording: !!active,
    isUploading: busy,
    elapsedSeconds: elapsed,
    start,
    stop,
    completed,
    dismissCompleted,
  };
}
