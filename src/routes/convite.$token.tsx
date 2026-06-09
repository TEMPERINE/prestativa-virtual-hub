import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { peekInvite, setPendingInviteToken, type InvitePeek } from "@/lib/invites";
import { toast } from "sonner";
import { Sparkles, Building2, Crown } from "lucide-react";

export const Route = createFileRoute("/convite/$token")({
  ssr: false,
  head: () => ({ meta: [{ title: "Convite — Prestativa Office" }] }),
  component: InvitePage,
});

function InvitePage() {
  const { token } = Route.useParams();
  const navigate = useNavigate();
  const [peek, setPeek] = useState<InvitePeek | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<"signup" | "signin">("signup");
  const [session, setSession] = useState<{ email: string } | null>(null);

  // form state
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const p = await peekInvite(token);
      setPeek(p);
      if (p.email_lock) setEmail(p.email_lock);
      const { data: u } = await supabase.auth.getUser();
      if (u.user?.email) setSession({ email: u.user.email });
      setLoading(false);
    })();
  }, [token]);

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!peek?.valid) return;
    setBusy(true);
    const displayName = (name.trim() || email.split("@")[0] || "Novo membro").slice(0, 24);
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/onboarding`,
        data: { display_name: displayName },
      },
    });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    setPendingInviteToken(token);
    if (!data.session) {
      toast.success("Conta criada! Verifique seu e-mail pra confirmar.");
      return;
    }
    toast.success("Conta criada! Vamos personalizar seu avatar.");
    navigate({ to: "/onboarding" });
  };

  const handleSignin = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    setPendingInviteToken(token);
    toast.success("Bem-vindo!");
    navigate({ to: "/onboarding" });
  };

  const handleAcceptLogged = async () => {
    setBusy(true);
    setPendingInviteToken(token);
    // Vai pro onboarding (se já onboardado, ele redireciona e redime)
    navigate({ to: "/onboarding" });
  };

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">Carregando convite…</div>;
  }

  if (!peek?.valid) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-gradient-to-br from-background via-accent/30 to-background">
        <div className="max-w-md glass-panel rounded-2xl p-8 text-center">
          <Sparkles className="mx-auto mb-3 text-muted-foreground" />
          <h1 className="text-xl font-semibold mb-2">Convite inválido ou expirado</h1>
          <p className="text-sm text-muted-foreground">Peça um novo link pra quem te convidou.</p>
        </div>
      </div>
    );
  }

  const planLabel = peek.plan === "premium" ? "Premium" : peek.plan === "pro" ? "Pro" : "Essencial";
  const isSignup = peek.kind === "signup";
  const tierLabel = peek.tier ? `Nível ${peek.tier}` : null;

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-gradient-to-br from-background via-accent/30 to-background">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl gradient-primary shadow-glow mb-4">
            {isSignup ? <Crown className="text-primary-foreground" /> : <Building2 className="text-primary-foreground" />}
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {isSignup ? "Seu espaço te aguarda" : `Convite para ${peek.workspace_name ?? "um espaço"}`}
          </h1>
          <p className="text-sm text-muted-foreground mt-2">
            {isSignup
              ? <>Crie sua conta no Prestativa Office com plano <b>{planLabel}</b>{tierLabel ? <> · <b>{tierLabel}</b></> : null}.</>
              : <>Entre como <b>{peek.role}</b> no espaço.</>}
          </p>
        </div>

        <div className="glass-panel rounded-2xl p-8 shadow-soft">
          {session ? (
            <div className="space-y-4 text-center">
              <p className="text-sm text-muted-foreground">Logado como <b>{session.email}</b>.</p>
              <button
                onClick={handleAcceptLogged}
                disabled={busy}
                className="w-full rounded-lg gradient-primary text-primary-foreground font-medium py-2.5 hover:opacity-90 disabled:opacity-50"
              >Aceitar convite e continuar</button>
            </div>
          ) : (
            <>
              <div className="flex gap-1 p-1 bg-muted rounded-lg mb-5">
                <button type="button" onClick={() => setMode("signup")}
                  className={`flex-1 py-2 rounded-md text-sm font-medium transition ${mode === "signup" ? "bg-background shadow-sm" : "text-muted-foreground"}`}>
                  Criar conta
                </button>
                <button type="button" onClick={() => setMode("signin")}
                  className={`flex-1 py-2 rounded-md text-sm font-medium transition ${mode === "signin" ? "bg-background shadow-sm" : "text-muted-foreground"}`}>
                  Já tenho conta
                </button>
              </div>

              <form onSubmit={mode === "signup" ? handleSignup : handleSignin} className="space-y-4">
                {mode === "signup" && (
                  <div>
                    <label className="block text-sm font-medium mb-1.5">Como devemos te chamar?</label>
                    <input type="text" value={name} onChange={(e) => setName(e.target.value)}
                      className="w-full rounded-lg border bg-background px-3 py-2.5 text-sm" placeholder="Seu primeiro nome" />
                  </div>
                )}
                <div>
                  <label className="block text-sm font-medium mb-1.5">Email</label>
                  <input type="email" required value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={!!peek.email_lock}
                    className="w-full rounded-lg border bg-background px-3 py-2.5 text-sm disabled:opacity-70" />
                  {peek.email_lock && (
                    <p className="text-[11px] text-muted-foreground mt-1">Esse convite é exclusivo pra esse email.</p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1.5">Senha</label>
                  <input type="password" required minLength={6} value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full rounded-lg border bg-background px-3 py-2.5 text-sm" placeholder="••••••••" />
                </div>
                <button type="submit" disabled={busy}
                  className="w-full rounded-lg gradient-primary text-primary-foreground font-medium py-2.5 hover:opacity-90 disabled:opacity-50">
                  {busy ? "Aguarde…" : mode === "signup" ? "Criar conta e entrar" : "Entrar"}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
