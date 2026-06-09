import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Mail, LogOut } from "lucide-react";

export const Route = createFileRoute("/_authenticated/aguardando-convite")({
  head: () => ({ meta: [{ title: "Aguardando convite — Prestativa Office" }] }),
  component: WaitingPage,
});

function WaitingPage() {
  const navigate = useNavigate();
  const signOut = async () => { await supabase.auth.signOut(); navigate({ to: "/auth" }); };
  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-gradient-to-br from-background via-accent/30 to-background">
      <div className="max-w-md text-center glass-panel rounded-2xl p-10">
        <Mail className="mx-auto mb-3 text-muted-foreground" />
        <h1 className="text-xl font-semibold mb-2">Sem acesso a espaços</h1>
        <p className="text-sm text-muted-foreground mb-6">
          Sua conta está ativa, mas você ainda não foi adicionado a nenhum espaço de trabalho.
          Fale com o administrador para receber acesso.
        </p>
        <button onClick={signOut} className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5">
          <LogOut size={14} /> Sair da conta
        </button>
      </div>
    </div>
  );
}
