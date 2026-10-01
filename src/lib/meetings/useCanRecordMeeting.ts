import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/** Pergunta ao banco (regra central can_record_meeting). Falha = sem botão. */
export function useCanRecordMeeting(workspaceId: string | null): boolean {
  const [can, setCan] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setCan(false);
    if (!workspaceId) return;
    const check = async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return;
      const { data } = await supabase.rpc("can_record_meeting", { _user_id: u.user.id, _workspace_id: workspaceId });
      if (!cancelled) setCan(data === true);
    };
    void check();
    const t = setInterval(check, 60_000); // troca de perfil vale sem recarregar
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [workspaceId]);
  return can;
}
