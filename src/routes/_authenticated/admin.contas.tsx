import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { ArrowLeft, Plus, KeyRound, Trash2, UserPlus, X } from "lucide-react";
import {
  adminListAccounts,
  adminCreateAccount,
  adminSetAccountPlan,
  adminResetPassword,
  adminDeleteAccount,
  adminAssignToWorkspace,
  adminRemoveFromWorkspace,
  adminListWorkspaces,
} from "@/lib/admin/accounts.functions";

export const Route = createFileRoute("/_authenticated/admin/contas")({
  ssr: false,
  head: () => ({ meta: [{ title: "Contas — Admin" }] }),
  component: AdminContasPage,
});

type Plan = "essencial" | "pro" | "premium";

type Account = {
  id: string;
  email: string;
  display_name?: string;
  plan?: Plan;
  roles?: string[];
  workspaces?: Array<{ id: string; name?: string; role: string }>;
  created_at: string;
  last_sign_in_at: string | null;
};

type Workspace = { id: string; name: string; tier: number };

function AdminContasPage() {
  const navigate = useNavigate();
  const listFn = useServerFn(adminListAccounts);
  const wsListFn = useServerFn(adminListWorkspaces);
  const createFn = useServerFn(adminCreateAccount);
  const setPlanFn = useServerFn(adminSetAccountPlan);
  const resetPwFn = useServerFn(adminResetPassword);
  const deleteFn = useServerFn(adminDeleteAccount);
  const assignFn = useServerFn(adminAssignToWorkspace);
  const unassignFn = useServerFn(adminRemoveFromWorkspace);

  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // create form
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [plan, setPlan] = useState<Plan>("essencial");
  const [wsId, setWsId] = useState<string>("");
  const [wsRole, setWsRole] = useState<"owner" | "admin" | "member">("member");

  const checkAdmin = async () => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) { navigate({ to: "/auth" }); return false; }
    const { data } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", u.user.id)
      .eq("role", "admin")
      .maybeSingle();
    return !!data;
  };

  const load = async () => {
    setLoading(true);
    const ok = await checkAdmin();
    setAllowed(ok);
    if (!ok) { setLoading(false); return; }
    try {
      const [a, w] = await Promise.all([listFn(), wsListFn()]);
      setAccounts((a as any).accounts);
      setWorkspaces((w as any).workspaces);
    } catch (e: any) {
      toast.error(e?.message ?? "Erro ao carregar.");
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await createFn({
        data: {
          email: email.trim(),
          password,
          displayName: displayName.trim(),
          plan,
          workspaceId: wsId || null,
          workspaceRole: wsRole,
        },
      });
      toast.success("Conta criada!");
      setEmail(""); setPassword(""); setDisplayName(""); setWsId("");
      load();
    } catch (e: any) {
      toast.error(e?.message ?? "Falha ao criar conta.");
    } finally {
      setBusy(false);
    }
  };

  const changePlan = async (userId: string, newPlan: Plan) => {
    try {
      await setPlanFn({ data: { userId, plan: newPlan } });
      toast.success("Plano atualizado.");
      setAccounts((prev) => prev.map((a) => a.id === userId ? { ...a, plan: newPlan } : a));
    } catch (e: any) { toast.error(e?.message ?? "Erro."); }
  };

  const resetPw = async (userId: string) => {
    const pw = prompt("Nova senha (mín. 6 caracteres):");
    if (!pw || pw.length < 6) return;
    try {
      await resetPwFn({ data: { userId, password: pw } });
      toast.success("Senha redefinida.");
    } catch (e: any) { toast.error(e?.message ?? "Erro."); }
  };

  const removeAccount = async (acc: Account) => {
    if (!confirm(`Excluir definitivamente a conta de ${acc.email}? Isto não pode ser desfeito.`)) return;
    try {
      await deleteFn({ data: { userId: acc.id } });
      toast.success("Conta excluída.");
      setAccounts((prev) => prev.filter((a) => a.id !== acc.id));
    } catch (e: any) { toast.error(e?.message ?? "Erro."); }
  };

  const assign = async (userId: string, workspaceId: string, role: "owner" | "admin" | "member") => {
    if (!workspaceId) return;
    try {
      await assignFn({ data: { userId, workspaceId, role } });
      toast.success("Acesso ao espaço concedido.");
      load();
    } catch (e: any) { toast.error(e?.message ?? "Erro."); }
  };

  const unassign = async (userId: string, workspaceId: string) => {
    try {
      await unassignFn({ data: { userId, workspaceId } });
      setAccounts((prev) => prev.map((a) => a.id === userId
        ? { ...a, workspaces: (a.workspaces ?? []).filter((w) => w.id !== workspaceId) }
        : a));
    } catch (e: any) { toast.error(e?.message ?? "Erro."); }
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
      <div className="max-w-5xl mx-auto px-6 py-10">
        <button onClick={() => navigate({ to: "/workspaces" })}
          className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 mb-6">
          <ArrowLeft size={14} /> Voltar
        </button>
        <h1 className="text-3xl font-semibold tracking-tight mb-2">Contas</h1>
        <p className="text-sm text-muted-foreground mb-8">
          Crie contas, defina planos e atribua acesso a espaços. Não há cadastro público — só você gerencia o acesso.
        </p>

        <form onSubmit={create} className="glass-panel rounded-2xl p-6 mb-10 space-y-4">
          <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            <UserPlus size={14} /> Nova conta
          </h2>
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Email" value={email} onChange={setEmail} type="email" required placeholder="pessoa@email.com" />
            <Field label="Nome de exibição" value={displayName} onChange={setDisplayName} placeholder="Ex: João Silva" />
            <Field label="Senha provisória" value={password} onChange={setPassword} type="text" required placeholder="mín. 6 caracteres" />
            <SelectField label="Plano" value={plan} onChange={(v) => setPlan(v as Plan)}
              options={[
                { value: "essencial", label: "Essencial (nível 1)" },
                { value: "pro", label: "Pro (níveis 1–2)" },
                { value: "premium", label: "Premium (níveis 1–3)" },
              ]} />
            <SelectField label="Adicionar ao espaço (opcional)" value={wsId} onChange={setWsId}
              options={[{ value: "", label: "— Nenhum —" }, ...workspaces.map((w) => ({ value: w.id, label: `${w.name} (N${w.tier})` }))]} />
            <SelectField label="Papel no espaço" value={wsRole} onChange={(v) => setWsRole(v as any)}
              options={[
                { value: "member", label: "Membro" },
                { value: "admin", label: "Admin" },
                { value: "owner", label: "Dono" },
              ]} />
          </div>
          <button type="submit" disabled={busy}
            className="px-4 py-2 rounded-lg gradient-primary text-primary-foreground text-sm font-medium inline-flex items-center gap-2 hover:opacity-90 shadow-glow disabled:opacity-50">
            <Plus size={14} /> {busy ? "Criando…" : "Criar conta"}
          </button>
        </form>

        <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground mb-3">
          Contas existentes ({accounts.length})
        </h2>
        <div className="space-y-2">
          {accounts.map((a) => (
            <div key={a.id} className="glass-panel rounded-xl p-4">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium flex items-center gap-2 flex-wrap">
                    <span>{a.display_name ?? a.email}</span>
                    {a.roles?.includes("admin") && (
                      <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-primary/15 text-primary">Admin</span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    {a.email} · último login: {a.last_sign_in_at ? new Date(a.last_sign_in_at).toLocaleString() : "nunca"}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <select
                    value={a.plan ?? "essencial"}
                    onChange={(e) => changePlan(a.id, e.target.value as Plan)}
                    className="rounded-lg border bg-background px-2 py-1 text-xs"
                  >
                    <option value="essencial">Essencial</option>
                    <option value="pro">Pro</option>
                    <option value="premium">Premium</option>
                  </select>
                  <button onClick={() => resetPw(a.id)} title="Redefinir senha"
                    className="p-2 rounded-lg bg-muted hover:bg-muted/70"><KeyRound size={14} /></button>
                  <button onClick={() => removeAccount(a)} title="Excluir conta"
                    className="p-2 rounded-lg bg-muted hover:bg-red-500/10 hover:text-red-500"><Trash2 size={14} /></button>
                </div>
              </div>

              <div className="mt-3 pl-1">
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">Espaços</div>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {(a.workspaces ?? []).length === 0 && (
                    <span className="text-xs text-muted-foreground italic">Sem acesso a nenhum espaço.</span>
                  )}
                  {(a.workspaces ?? []).map((w) => (
                    <span key={w.id} className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-muted">
                      {w.name ?? w.id.slice(0, 6)} · {w.role}
                      <button onClick={() => unassign(a.id, w.id)} className="hover:text-red-500">
                        <X size={10} />
                      </button>
                    </span>
                  ))}
                </div>
                <AssignControl
                  workspaces={workspaces.filter((w) => !(a.workspaces ?? []).some((aw) => aw.id === w.id))}
                  onAssign={(workspaceId, role) => assign(a.id, workspaceId, role)}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, type = "text", required, placeholder }: {
  label: string; value: string; onChange: (v: string) => void;
  type?: string; required?: boolean; placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-xs font-medium mb-1.5">{label}</label>
      <input value={value} onChange={(e) => onChange(e.target.value)} type={type} required={required}
        placeholder={placeholder}
        className="w-full rounded-lg border bg-background px-3 py-2 text-sm" />
    </div>
  );
}

function SelectField({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <div>
      <label className="block text-xs font-medium mb-1.5">{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border bg-background px-3 py-2 text-sm">
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

function AssignControl({ workspaces, onAssign }: {
  workspaces: Workspace[];
  onAssign: (workspaceId: string, role: "owner" | "admin" | "member") => void;
}) {
  const [wsId, setWsId] = useState("");
  const [role, setRole] = useState<"owner" | "admin" | "member">("member");
  if (workspaces.length === 0) return null;
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <select value={wsId} onChange={(e) => setWsId(e.target.value)}
        className="rounded-lg border bg-background px-2 py-1 text-xs">
        <option value="">+ adicionar a um espaço…</option>
        {workspaces.map((w) => <option key={w.id} value={w.id}>{w.name} (N{w.tier})</option>)}
      </select>
      {wsId && (
        <>
          <select value={role} onChange={(e) => setRole(e.target.value as any)}
            className="rounded-lg border bg-background px-2 py-1 text-xs">
            <option value="member">Membro</option>
            <option value="admin">Admin</option>
            <option value="owner">Dono</option>
          </select>
          <button onClick={() => { onAssign(wsId, role); setWsId(""); }}
            className="text-xs px-2 py-1 rounded bg-primary text-primary-foreground hover:opacity-90">
            Conceder
          </button>
        </>
      )}
    </div>
  );
}
