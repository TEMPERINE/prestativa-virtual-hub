import { useEffect, useRef, useState } from "react";
import { ACTIVE_RTC_ENGINE } from "@/lib/rtc/useLiveKit";
import { MeetingTrackerV2, type MeetingRoomState } from "./meeting-tracker-v2";
import { supabase } from "@/integrations/supabase/client";
import { getCurrentWorkspaceId } from "@/lib/workspace/current";

// Os tipos auto-gerados ainda não conhecem as RPCs `meeting_join` /
// `meeting_leave`. Usamos um wrapper sem types para evitar ruído de TS — as
// funções estão definidas como SECURITY DEFINER no banco.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rpc = (supabase as any).rpc.bind(supabase) as (
  fn: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: unknown }>;

type Args = {
  /** Id e label da zona em que o usuário está agora. */
  zoneId: string;
  zoneLabel: string;
  /** Se a zona atual é uma sala de reunião (suporta vídeo). */
  isMeetingZone: boolean;
  /** Quantos peers conectados via RTC. */
  peerCount: number;
  /** O user já está autenticado? Se null/false, hook não faz nada. */
  enabled: boolean;
  /** V2: estado da Room vindo do LiveKitRoomManager (fonte de verdade). */
  v2Room?: MeetingRoomState | null;
  /** V2: label para o zoneId efetivamente conectado. */
  labelFor?: (zoneId: string) => string;
};

/**
 * Registra automaticamente entradas e saídas em "reuniões" — agrupando todos
 * que estão simultaneamente numa sala de reunião (zona com supportsVideo) e
 * com pelo menos 1 outro peer conectado. Persiste em `meetings` e
 * `meeting_participants` via RPCs SECURITY DEFINER no banco.
 *
 * A lógica é defensiva: só uma reunião ativa por vez para o usuário. Se ele
 * sai da sala ou todos os peers caem, fechamos a participação. Se ele troca
 * de sala, fecha a anterior e abre uma nova.
 */
function useMeetingTrackerV1({ zoneId, zoneLabel, isMeetingZone, peerCount, enabled }: Args) {
  const [activeMeetingId, setActiveMeetingId] = useState<string | null>(null);
  const activeMeetingRef = useRef<string | null>(null);
  const activeZoneRef = useRef<string | null>(null);
  const inFlightRef = useRef(false);

  const setActive = (id: string | null) => {
    activeMeetingRef.current = id;
    setActiveMeetingId(id);
  };

  // Debounce: evita criar reunião por flutuação rápida de zona.
  useEffect(() => {
    if (!enabled) return;

    // Só consideramos "em reunião" quando estamos numa sala de reunião
    // E há pelo menos 1 outro peer conectado via RTC.
    const shouldBeIn = isMeetingZone && peerCount >= 1;
    const sameZone = activeZoneRef.current === zoneId;

    // Caso 1: deveria estar numa reunião e ainda não está (ou trocou de zona).
    if (shouldBeIn && (!activeMeetingRef.current || !sameZone)) {
      const timer = window.setTimeout(async () => {
        if (inFlightRef.current) return;
        inFlightRef.current = true;
        try {
          // Se trocou de zona com reunião ativa, sai da anterior antes.
          if (activeMeetingRef.current && !sameZone) {
            const prev = activeMeetingRef.current;
            setActive(null);
            await rpc("meeting_leave", { _meeting_id: prev });
          }
          const ws = getCurrentWorkspaceId();
          if (!ws) {
            console.warn("[meeting] workspace ainda não setado; tentando depois");
            return;
          }
          const { data, error } = await rpc("meeting_join", {
            _workspace_id: ws,
            _zone_id: zoneId,
            _zone_label: zoneLabel,
          });
          if (error) {
            console.error("[meeting] meeting_join falhou:", error);
            return;
          }
          if (data) {
            setActive(data as string);
            activeZoneRef.current = zoneId;
          }
        } finally {
          inFlightRef.current = false;
        }
      }, 1500);
      return () => window.clearTimeout(timer);
    }

    // Caso 2: já está registrado mas não deveria mais estar (saiu da zona).
    if (!shouldBeIn && activeMeetingRef.current) {
      const timer = window.setTimeout(async () => {
        const id = activeMeetingRef.current;
        if (!id) return;
        setActive(null);
        activeZoneRef.current = null;
        await rpc("meeting_leave", { _meeting_id: id });
      }, 4000); // tolera quedas rápidas de zona / reconexão
      return () => window.clearTimeout(timer);
    }
  }, [enabled, isMeetingZone, peerCount, zoneId, zoneLabel]);

  // Limpa ao desmontar (sair do escritório / refresh).
  useEffect(() => {
    return () => {
      const id = activeMeetingRef.current;
      if (id) {
        activeMeetingRef.current = null;
        void rpc("meeting_leave", { _meeting_id: id });
      }
    };
  }, []);

  return { activeMeetingId };
}

/**
 * V2 — join/leave derivados exclusivamente da Room privada realmente
 * CONNECTED (ver meeting-tracker-v2.ts). Falhas só são logadas.
 */
function useMeetingTrackerV2({ enabled, v2Room, labelFor }: Args) {
  const [activeMeetingId, setActiveMeetingId] = useState<string | null>(null);
  const labelRef = useRef(labelFor);
  labelRef.current = labelFor;
  const [tracker, setTracker] = useState<MeetingTrackerV2 | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const t = new MeetingTrackerV2({
      join: async (zoneId) => {
        const ws = getCurrentWorkspaceId();
        if (!ws) throw new Error("workspace ainda não setado");
        const { data, error } = await rpc("meeting_join", {
          _workspace_id: ws,
          _zone_id: zoneId,
          _zone_label: labelRef.current?.(zoneId) ?? zoneId,
        });
        if (error) throw error;
        return (data as string | null) ?? null;
      },
      leave: async (id) => {
        const { error } = await rpc("meeting_leave", { _meeting_id: id });
        if (error) throw error;
      },
      onError: (op, err, attempt, final) =>
        console.error(
          `[meeting] meeting_${op} falhou (tentativa ${attempt}${final ? ", desistindo" : ""}; mídia não afetada):`,
          err,
        ),
      onChange: setActiveMeetingId,
    });
    setTracker(t);
    return () => {
      setTracker(null);
      void t.dispose();
    };
  }, [enabled]);

  const status = v2Room?.status ?? null;
  const connected = v2Room?.connected ?? null;
  useEffect(() => {
    tracker?.observe({ status, connected });
  }, [tracker, status, connected]);

  return { activeMeetingId };
}

export const useMeetingTracker: (args: Args) => { activeMeetingId: string | null } =
  ACTIVE_RTC_ENGINE === "v2" ? useMeetingTrackerV2 : useMeetingTrackerV1;
