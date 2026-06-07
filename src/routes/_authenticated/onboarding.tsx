import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { OnboardingWizard } from "@/components/onboarding/OnboardingWizard";

export const Route = createFileRoute("/_authenticated/onboarding")({
  head: () => ({ meta: [{ title: "Personalize seu avatar — Prestativa Office" }] }),
  component: OnboardingPage,
});

function OnboardingPage() {
  const navigate = useNavigate();
  const [state, setState] = useState<{ userId: string; name: string } | null>(null);

  useEffect(() => {
    let cancel = false;
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) { navigate({ to: "/auth" }); return; }
      const { data: prof } = await supabase
        .from("profiles")
        .select("display_name, onboarded_at")
        .eq("id", u.user.id)
        .maybeSingle();
      if (cancel) return;
      if (prof?.onboarded_at) { navigate({ to: "/workspaces" }); return; }
      setState({
        userId: u.user.id,
        name: prof?.display_name ?? u.user.email?.split("@")[0] ?? "Novo membro",
      });
    })();
    return () => { cancel = true; };
  }, [navigate]);

  if (!state) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">
        Carregando…
      </div>
    );
  }

  return (
    <OnboardingWizard
      userId={state.userId}
      initialName={state.name}
      onDone={() => navigate({ to: "/workspaces" })}
    />
  );
}
