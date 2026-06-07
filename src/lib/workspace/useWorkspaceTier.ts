// Hook simples para buscar o tier do workspace atual em memória, com
// cache em módulo para evitar refetch a cada montagem. Inválida cache
// quando o workspaceId muda.

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getTierCaps, type TierCapabilities } from "./tiers";

const cache = new Map<string, number>();

export function useWorkspaceTier(workspaceId: string | null | undefined): {
  tier: number;
  caps: TierCapabilities;
  loading: boolean;
} {
  const [tier, setTier] = useState<number>(() =>
    workspaceId ? cache.get(workspaceId) ?? 1 : 1
  );
  const [loading, setLoading] = useState<boolean>(
    !!workspaceId && !cache.has(workspaceId)
  );

  useEffect(() => {
    if (!workspaceId) {
      setTier(1);
      setLoading(false);
      return;
    }
    if (cache.has(workspaceId)) {
      setTier(cache.get(workspaceId)!);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      const { data } = await supabase
        .from("workspaces")
        .select("tier")
        .eq("id", workspaceId)
        .maybeSingle();
      if (cancelled) return;
      const t = (data as any)?.tier ?? 1;
      cache.set(workspaceId, t);
      setTier(t);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  return { tier, caps: getTierCaps(tier), loading };
}

/** Útil quando você só tem o id no localStorage e quer um snapshot rápido. */
export function getCachedTier(workspaceId: string | null | undefined): number | null {
  if (!workspaceId) return null;
  return cache.get(workspaceId) ?? null;
}

export function primeWorkspaceTierCache(workspaceId: string, tier: number) {
  cache.set(workspaceId, tier);
}
