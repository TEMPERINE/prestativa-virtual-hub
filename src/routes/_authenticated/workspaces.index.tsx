import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Building2, LogOut, ArrowRight, Sparkles, Mail } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/workspaces/")({
  head: () => ({ meta: [{ title: "Seus escritórios — Prestativa Office" }] }),
  component: WorkspacesHubPage,
});

type WorkspaceCard = {
  id: string;
  name: string;
  description: string | null;
  cover_url: string | null;
  role: string;
};

type InviteRow = {
  id: string;
  token: string;
  role: string;
  workspace_id: string;
  workspaces: { name: string; description: string | null } | null;
};

function WorkspacesHubPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<{ display_name: string } | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceCard[]>([]);
  const [invites, setInvites] = useState<InviteRow[]>([]);
  const [busyToken, setBusyToken] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) { navigate({ to: "/auth" }); return; }

    const { data: prof } = await supabase
      .from("profiles")
      .select("display_name, onboarded_at")
      .eq("id", u.user.id)
      .maybeSingle();

    if (!prof?.onboarded_at) {
      navigate({ to: "/onboarding" });
      return;
    }
    setProfile({ display_name: prof.display_name });

    const { data: mems } = await supabase
      .from("workspace_members")
      .select("role, workspace_id, workspaces:workspace_id ( id, name, description, cover_url )")
      .eq("user_id", u.user.id);

    const cards: WorkspaceCard[] = (mems ?? [])
      .map((m: any) => m.workspaces ? {
        id: m.workspaces.id,
        name: m.workspaces.name,
        description: m.workspaces.description,
        cover_url: m.workspaces.cover_url,
        role: m.role,
      } : null)
      .filter(Boolean) as WorkspaceCard[];
    setWorkspaces(cards);

    const { data: inv } = await supabase
      .from("workspace_invites")
      .select("id, token, role, workspace_id, workspaces:workspace_id ( name, description )")
      .is("accepted_at", null)
      .gt("expires_at", new Date().toISOString());
    setInvites((inv ?? []) as any);

    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const acceptInvite = async (token: string) => {
    setBusyToken(token);
    const { data, error } = await supabase.rpc("workspace_accept_invite", { _token: token });
    setBusyToken(null);
    if (error) { toast.error(error.message); return; }
    toast.success("Convite aceito!");
    if (data) {
      try { localStorage.setItem("lastWorkspaceId", data as string); } catch {}
      navigate({ to: "/workspaces/$workspaceId", params: { workspaceId: data as string } });
    } else {
      load();
    }
  };

  const enter = (id: string) => {
    try { localStorage.setItem("lastWorkspaceId", id); } catch {}
    navigate({ to: "/workspaces/$workspaceId", params: { workspaceId: id } });
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/auth" });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-accent/20 to-background">
      <div className="max-w-5xl mx-auto px-6 py-12">
        <header className="flex items-center justify-between mb-10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl gradient-primary flex items-center justify-center shadow-glow">
              <span className="text-primary-foreground font-bold">P</span>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground">Prestativa</div>
              <div className="text-sm font-medium">
                Olá, {profile?.display_name ?? "—"} 👋
              </div>
            </div>
          </div>
          <button
            onClick={signOut}
            className="text-xs text-muted-foreground hover:text-foreground transition inline-flex items-center gap-1.5"
          >
            <LogOut size={14} /> Sair
          </button>
        </header>

        <div className="mb-8">
          <h1 className="text-3xl font-semibold tracking-tight mb-2">Seus escritórios</h1>
          <p className="text-sm text-muted-foreground">
            Escolha um espaço para entrar. Cada escritório tem seu próprio mapa, equipe e reuniões.
          </p>
        </div>

        {invites.length > 0 && (
          <section className="mb-8">
            <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
              <Mail size={14} /> Convites pendentes
            </div>
            <div className="space-y-2">
              {invites.map((inv) => (
                <div key={inv.id} className="glass-panel rounded-xl p-4 flex items-center justify-between">
                  <div>
                    <div className="font-medium">{inv.workspaces?.name ?? "Escritório"}</div>
                    <div className="text-xs text-muted-foreground">
                      Você foi convidado como {inv.role}.
                    </div>
                  </div>
                  <button
                    onClick={() => acceptInvite(inv.token)}
                    disabled={busyToken === inv.token}
                    className="px-3 py-1.5 rounded-lg gradient-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-50"
                  >
                    {busyToken === inv.token ? "Aceitando…" : "Aceitar"}
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        {loading ? (
          <div className="text-sm text-muted-foreground">Carregando seus espaços…</div>
        ) : workspaces.length === 0 ? (
          <div className="glass-panel rounded-2xl p-10 text-center">
            <Sparkles className="mx-auto mb-3 text-muted-foreground" />
            <h2 className="text-lg font-medium mb-1">Nenhum escritório por enquanto</h2>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Você ainda não foi adicionado a nenhum escritório. Peça um convite ao administrador
              para entrar em um espaço de trabalho.
            </p>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 gap-4">
            {workspaces.map((ws) => (
              <button
                key={ws.id}
                onClick={() => enter(ws.id)}
                className="group text-left glass-panel rounded-2xl p-6 hover:shadow-soft transition-all border border-transparent hover:border-primary/30"
              >
                <div className="flex items-start justify-between">
                  <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-4">
                    {ws.cover_url ? (
                      <img src={ws.cover_url} alt="" className="w-full h-full object-cover rounded-xl" />
                    ) : (
                      <Building2 className="text-primary" />
                    )}
                  </div>
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground bg-muted px-2 py-1 rounded-full">
                    {ws.role}
                  </span>
                </div>
                <div className="font-semibold text-lg mb-1">{ws.name}</div>
                {ws.description && (
                  <div className="text-sm text-muted-foreground mb-4 line-clamp-2">{ws.description}</div>
                )}
                <div className="text-xs text-primary inline-flex items-center gap-1 group-hover:gap-2 transition-all">
                  Entrar no espaço <ArrowRight size={12} />
                </div>
              </button>
            ))}
          </div>
        )}

        <div className="mt-10 text-xs text-muted-foreground text-center">
          <Link to="/meetings" className="hover:text-foreground transition">Minhas reuniões →</Link>
        </div>
      </div>
    </div>
  );
}
