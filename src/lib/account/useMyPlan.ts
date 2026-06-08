// Hook do plano da CONTA do usuário logado (Essencial/Pro/Premium).
// Cache em módulo pra evitar refetch entre montagens. Invalida em sign-in/out
// pela camada de auth — aqui só damos `refresh()` se precisar.

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  ACCOUNT_PLANS,
  DEFAULT_PLAN,
  getPlanInfo,
  type AccountPlan,
  type AccountPlanInfo,
} from "./plans";

let cachedPlan: AccountPlan | null = null;
let cachedUserId: string | null = null;

export function useMyPlan(): {
  plan: AccountPlan;
  info: AccountPlanInfo;
  loading: boolean;
  refresh: () => Promise<void>;
} {
  const [plan, setPlan] = useState<AccountPlan>(cachedPlan ?? DEFAULT_PLAN);
  const [loading, setLoading] = useState<boolean>(cachedPlan === null);

  const load = async () => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) {
      cachedPlan = null;
      cachedUserId = null;
      setPlan(DEFAULT_PLAN);
      setLoading(false);
      return;
    }
    if (cachedPlan && cachedUserId === u.user.id) {
      setPlan(cachedPlan);
      setLoading(false);
      return;
    }
    const { data } = await supabase
      .from("profiles")
      .select("plan")
      .eq("id", u.user.id)
      .maybeSingle();
    const next = ((data as any)?.plan ?? DEFAULT_PLAN) as AccountPlan;
    const safe = next in ACCOUNT_PLANS ? next : DEFAULT_PLAN;
    cachedPlan = safe;
    cachedUserId = u.user.id;
    setPlan(safe);
    setLoading(false);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await load();
      if (cancelled) return;
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    plan,
    info: getPlanInfo(plan),
    loading,
    refresh: async () => {
      cachedPlan = null;
      await load();
    },
  };
}
