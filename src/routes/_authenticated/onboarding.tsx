import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { OnboardingWizard } from "@/components/onboarding/OnboardingWizard";
import { redeemPendingInvite, getPendingInviteToken } from "@/lib/invites";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/onboarding")({
  head: () => ({ meta: [{ title: "Personalize seu avatar — Prestativa Office" }] }),
  component: OnboardingPage,
});

async function finishWithInvite(navigate: ReturnType<typeof useNavigate>) {
  try {
    const wsId = await redeemPendingInvite();
    if (wsId) {
      try { localStorage.setItem("lastWorkspaceId", wsId); } catch {}
      navigate({ to: "/workspaces/$workspaceId", params: { workspaceId: wsId } });
      return;
    }
  } catch (e: any) {
    toast.error(e?.message ?? "Falha ao aceitar convite.");
  }
  // Sem convite (ou já consumido): vai pro hub. Se a pessoa não tiver workspace,
  // o hub já mostra mensagem; se nem convite nem workspace, mandamos pra espera.
  const { data: u } = await supabase.auth.getUser();
  if (u.user) {
    const { count } = await supabase
      .from("workspace_members")
      .select("workspace_id", { count: "exact", head: true })
      .eq("user_id", u.user.id);
    if ((count ?? 0) === 0) {
      navigate({ to: "/aguardando-convite" });
      return;
    }
  }
  navigate({ to: "/workspaces" });
}

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
      if (prof?.onboarded_at) {
        // Já onboardado: se há convite pendente, redime e vai pro workspace.
        if (getPendingInviteToken()) {
          await finishWithInvite(navigate);
        } else {
          navigate({ to: "/workspaces" });
        }
        return;
      }
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
      onDone={() => finishWithInvite(navigate)}
    />
  );
}
