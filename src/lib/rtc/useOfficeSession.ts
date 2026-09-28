import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { OfficeSessionState } from "./office-session";
import {
  OfficeSessionBinder,
  browserBindingEnv,
  type OfficeSessionBindingHandle,
} from "./office-session-binding";
import { createSupabaseOfficeSessionBackend } from "./office-session-supabase";

let binder: OfficeSessionBinder | null = null;
function getBinder() {
  if (!binder) {
    binder = new OfficeSessionBinder(
      () => createSupabaseOfficeSessionBackend(supabase),
      browserBindingEnv(),
    );
  }
  return binder;
}

const IDLE: OfficeSessionState = {
  status: "IDLE",
  sessionId: null,
  generation: null,
  workspaceId: null,
  error: null,
};

/** Sessão única do Office para (userId, workspaceId). Null = ainda não pronto para claim. */
export function useOfficeSession(userId: string | null, workspaceId: string | null) {
  const [state, setState] = useState<OfficeSessionState>(IDLE);
  const handleRef = useRef<OfficeSessionBindingHandle | null>(null);

  useEffect(() => {
    if (!userId || !workspaceId) return;
    const h = getBinder().acquire(userId, workspaceId);
    handleRef.current = h;
    setState(h.getState());
    const off = h.subscribe(setState);
    return () => {
      off();
      handleRef.current = null;
      h.release();
    };
  }, [userId, workspaceId]);

  const retry = useCallback(() => {
    void handleRef.current?.retry();
  }, []);

  return { state, retry };
}
