/**
 * Adaptador Supabase para OfficeSessionController (RTC v2, Etapa 3).
 * Canal privado `user:{userId}:session`, evento broadcast `SESSION_REPLACED`.
 * Ainda não conectado ao produto.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { OfficeSessionBackend, SessionReplacedEvent } from "./office-session";

export const SESSION_REPLACED_EVENT = "SESSION_REPLACED";

export function sessionTopic(userId: string): string {
  return `user:${userId}:session`;
}

export function createSupabaseOfficeSessionBackend(
  supabase: SupabaseClient<Database>,
): OfficeSessionBackend {
  return {
    async claim(sessionId, workspaceId) {
      const { data, error } = await supabase.rpc("claim_office_session", {
        _session_id: sessionId,
        _workspace_id: workspaceId,
      });
      if (error) throw new Error(error.message);
      const row = Array.isArray(data) ? data[0] : data;
      if (!row) throw new Error("claim_office_session sem retorno");
      return { sessionId: row.session_id, generation: Number(row.generation) };
    },
    async release(sessionId, generation) {
      const { data, error } = await supabase.rpc("release_office_session", {
        _session_id: sessionId,
        _generation: generation,
      });
      if (error) throw new Error(error.message);
      return data === true;
    },
    async fetchCurrent() {
      const { data, error } = await supabase
        .from("office_sessions")
        .select("session_id, generation, active")
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return null;
      return {
        sessionId: data.session_id,
        generation: Number(data.generation),
        active: data.active,
      };
    },
    openTakeoverChannel(userId, handlers) {
      let subscribedOnce = false;
      const channel = supabase.channel(sessionTopic(userId), {
        config: { private: true, broadcast: { self: false, ack: true } },
      });
      channel.on("broadcast", { event: SESSION_REPLACED_EVENT }, ({ payload }) => {
        const p = payload as Partial<SessionReplacedEvent>;
        if (typeof p?.generation === "number" && typeof p?.sessionId === "string") {
          handlers.onReplaced({ sessionId: p.sessionId, generation: p.generation });
        }
      });
      channel.subscribe((status) => {
        if (status === "SUBSCRIBED") {
          handlers.onSubscribed(subscribedOnce);
          subscribedOnce = true;
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          console.warn("[office-session] canal de sessão:", status);
        }
      });
      return {
        async broadcastReplaced(event) {
          const res = await channel.send({
            type: "broadcast",
            event: SESSION_REPLACED_EVENT,
            payload: event,
          });
          if (res !== "ok") throw new Error(`broadcast ${res}`);
        },
        async unsubscribe() {
          await supabase.removeChannel(channel);
        },
      };
    },
  };
}
