import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Presença Supabase por sala. Quando o usuário entra numa zona de reunião,
 * faz `track({})` no canal `room:{workspaceId}:{zoneId}`. Todos os clientes
 * recebem o mesmo `presence sync` — fonte simétrica de "quem está aqui".
 *
 * Devolve a lista de userIds presentes (sem o próprio). Igual em todos os
 * navegadores, sem janela de assimetria do broadcast de posições.
 *
 * Quando `roomKey` é null (lobby, ou usuário não autenticado), o hook não
 * conecta a nada e devolve roster vazio.
 */
export function useRoomRoster(
  roomKey: string | null,
  myId: string | null,
): string[] {
  const [roster, setRoster] = useState<string[]>([]);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  useEffect(() => {
    if (!roomKey || !myId) {
      setRoster([]);
      return;
    }
    const ch = supabase.channel(`room:${roomKey}`, {
      config: { presence: { key: myId } },
    });
    channelRef.current = ch;

    const computeRoster = () => {
      const state = ch.presenceState() as Record<string, unknown[]>;
      const ids = Object.keys(state).filter((id) => id !== myId);
      setRoster((prev) => {
        if (prev.length === ids.length && prev.every((id) => ids.includes(id))) return prev;
        return ids.sort();
      });
    };

    ch.on("presence", { event: "sync" }, computeRoster);
    ch.on("presence", { event: "join" }, computeRoster);
    ch.on("presence", { event: "leave" }, computeRoster);

    void ch.subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        try {
          await ch.track({ joined_at: Date.now() });
        } catch (err) {
          console.warn("[room-roster] track failed", err);
        }
      }
    });

    return () => {
      try { void ch.untrack(); } catch { /* noop */ }
      supabase.removeChannel(ch);
      channelRef.current = null;
      setRoster([]);
    };
  }, [roomKey, myId]);

  return roster;
}
