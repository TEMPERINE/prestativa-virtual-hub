import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Copy, Trash2, Plus, ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/invites")({
  ssr: false,
  head: () => ({ meta: [{ title: "Convites de cadastro — Admin" }] }),
  component: AdminInvitesPage,
});

type Row = {
  id: string;
  token: string;
  email: string | null;
  plan: "essencial" | "pro" | "premium";
  tier: number;
  workspace_name_suggestion: string | null;
  max_uses: number;
  uses: number;
  expires_at: string;
  notes: string | null;
  created_at: string;
};

function AdminInvitesPage() {
  const navigate = useNavigate();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  // form
  const [email, setEmail] = useState("");
  const [plan, setPlan] = useState<"essencial" | "pro" | "premium">("essencial");
  const [tier, setTier] = useState<1 | 2 | 3>(1);
  const [wsName, setWsName] = useState("");
  const [maxUses, setMaxUses] = useState(1);
  const [days, setDays] = useState(30);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) { navigate({ to: "/auth" }); return; }
    const { data: rolesData } = await supabase.from("user_roles").select("role").eq("user_id", u.user.id);
    const isAdmin = (rolesData ?? []).some((r: any) => r.role === "admin");
    setAllowed(isAdmin);
    if (!isAdmin) { setLoading(false); return; }
    const { data, error } = await (supabase as any).from("signup_invites")
      .select("*").order("created_at", { ascending: false });
    if (error) toast.error(error.message);
    else setRows((data ?? []) as Row[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const { data: u } = await supabase.auth.getUser();
    const expires = new Date(Date.now() + days * 86400000).toISOString();
    const { error } = await (supabase as any).from("signup_invites").insert({
      email: email.trim() || null,
      plan, tier,
      workspace_name_suggestion: wsName.trim() || null,
      max_uses: Math.max(1, maxUses),
      notes: notes.trim() || null,
      expires_at: expires,
      created_by: u.user!.id,
    });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Convite criado!");
    setEmail(""); setWsName(""); setNotes(""); setMaxUses(1);
    load();
  };

  const copyLink = (token: string) => {
    const url = `${window.location.origin}/convite/${token}`;
    navigator.clipboard.writeText(url);
    toast.success("Link copiado!");
  };

  const remove = async (id: string) => {
    if (!confirm("Excluir esse convite?")) return;
    const { error } = await (supabase as any).from("signup_invites").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    load();
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">Carregando…</div>;
  if (!allowed) return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="max-w-md text-center glass-panel rounded-2xl p-8">
        <h1 className="text-lg font-semibold mb-2">Acesso restrito</h1>
        <p className="text-sm text-muted-foreground">Essa página é só para administradores.</p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-accent/20 to-background">
      <div className="max-w-4xl mx-auto px-6 py-10">
        <button onClick={() => navigate({ to: "/workspaces" })}
          className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 mb-6">
          <ArrowLeft size={14} /> Voltar
        </button>
        <h1 className="text-3xl font-semibold tracking-tight mb-2">Convites de cadastro</h1>
        <p className="text-sm text-muted-foreground mb-8">
          Gera links de signup. Quem usar vira dono de um espaço novo com o plano e nível definidos aqui.
        </p>

        <form onSubmit={create} className="glass-panel rounded-2xl p-6 mb-10 space-y-4">
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium mb-1.5">Email (opcional — vazio = qualquer email)</label>
              <input value={email} onChange={(e) => setEmail(e.target.value)} type="email"
                placeholder="convidado@email.com"
                className="w-full rounded-lg border bg-background px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1.5">Nome sugerido do espaço (opcional)</label>
              <input value={wsName} onChange={(e) => setWsName(e.target.value)}
                placeholder="Ex: Acme Corp"
                className="w-full rounded-lg border bg-background px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1.5">Plano</label>
              <select value={plan} onChange={(e) => setPlan(e.target.value as any)}
                className="w-full rounded-lg border bg-background px-3 py-2 text-sm">
                <option value="essencial">Essencial (nível 1)</option>
                <option value="pro">Pro (nível 1–2)</option>
                <option value="premium">Premium (nível 1–3)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1.5">Nível do espaço</label>
              <select value={tier} onChange={(e) => setTier(Number(e.target.value) as any)}
                className="w-full rounded-lg border bg-background px-3 py-2 text-sm">
                <option value={1}>Nível 1</option>
                <option value={2}>Nível 2</option>
                <option value={3}>Nível 3</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1.5">Máx. usos</label>
              <input type="number" min={1} value={maxUses} onChange={(e) => setMaxUses(Number(e.target.value))}
                className="w-full rounded-lg border bg-background px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1.5">Validade (dias)</label>
              <input type="number" min={1} value={days} onChange={(e) => setDays(Number(e.target.value))}
                className="w-full rounded-lg border bg-background px-3 py-2 text-sm" />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium mb-1.5">Observações (interno)</label>
              <input value={notes} onChange={(e) => setNotes(e.target.value)}
                className="w-full rounded-lg border bg-background px-3 py-2 text-sm" />
            </div>
          </div>
          <button type="submit" disabled={busy}
            className="px-4 py-2 rounded-lg gradient-primary text-primary-foreground text-sm font-medium inline-flex items-center gap-2 hover:opacity-90 shadow-glow disabled:opacity-50">
            <Plus size={14} /> {busy ? "Criando…" : "Gerar link de convite"}
          </button>
        </form>

        <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground mb-3">Convites gerados</h2>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum convite ainda.</p>
        ) : (
          <div className="space-y-2">
            {rows.map((r) => {
              const expired = new Date(r.expires_at) <= new Date();
              const exhausted = r.uses >= r.max_uses;
              return (
                <div key={r.id} className="glass-panel rounded-xl p-4 flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium flex items-center gap-2 flex-wrap">
                      <span>{r.workspace_name_suggestion ?? "(sem nome sugerido)"}</span>
                      <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-primary/10 text-primary">{r.plan}</span>
                      <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-muted">N{r.tier}</span>
                      {expired && <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-red-500/10 text-red-500">Expirado</span>}
                      {exhausted && !expired && <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-green-500/10 text-green-600">Usado</span>}
                    </div>
                    <div className="text-xs text-muted-foreground truncate">
                      {r.email ?? "qualquer email"} · usos {r.uses}/{r.max_uses} · expira {new Date(r.expires_at).toLocaleDateString()}
                      {r.notes ? ` · ${r.notes}` : ""}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => copyLink(r.token)} title="Copiar link"
                      className="p-2 rounded-lg bg-muted hover:bg-muted/70"><Copy size={14} /></button>
                    <button onClick={() => remove(r.id)} title="Excluir"
                      className="p-2 rounded-lg bg-muted hover:bg-red-500/10 hover:text-red-500"><Trash2 size={14} /></button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
