import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { getPendingInviteToken } from "@/lib/invites";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Entrar — Prestativa Office" },
      { name: "description", content: "Acesse o espaço virtual da Prestativa." },
    ],
  }),
  beforeLoad: async () => {
    if (typeof window !== "undefined") {
      const { data } = await supabase.auth.getSession();
      if (data.session) throw redirect({ to: "/workspaces" });
    }
  },
  component: AuthPage,
});

function AuthPage() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  // Signup só é permitido quando há um convite pendente (link recebido por convite).
  const [signupAllowed, setSignupAllowed] = useState(false);
  useEffect(() => { setSignupAllowed(!!getPendingInviteToken()); }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    if (mode === "signin") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      setLoading(false);
      if (error) { toast.error(error.message); return; }
      toast.success("Bem-vindo(a) ao Virtual Office!");
      window.location.href = "/workspaces";
    } else {
      const displayName = (name.trim() || email.split("@")[0] || "Novo membro").slice(0, 24);
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/workspaces`,
          data: { display_name: displayName },
        },
      });
      setLoading(false);
      if (error) { toast.error(error.message); return; }
      if (!data.session) {
        toast.success("Confira seu e-mail para confirmar o cadastro.");
        return;
      }
      toast.success("Conta criada no Virtual Office! Vamos personalizar seu avatar.");
      window.location.href = "/workspaces";
    }
  };

  const isSignup = mode === "signup";

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-gradient-to-br from-background via-accent/30 to-background">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl gradient-primary shadow-glow mb-4">
            <span className="text-2xl font-bold text-primary-foreground">P</span>
          </div>
          <h1 className="text-3xl font-semibold tracking-tight">Prestativa Office</h1>
          <p className="text-sm text-muted-foreground mt-2">
            Seu espaço virtual. Presença, proximidade, colaboração.
          </p>
        </div>

        <div className="glass-panel rounded-2xl p-8 shadow-soft">
          <div className="flex gap-1 p-1 bg-muted rounded-lg mb-5">
            <button
              type="button"
              onClick={() => setMode("signin")}
              className={`flex-1 py-2 rounded-md text-sm font-medium transition ${!isSignup ? "bg-background shadow-sm" : "text-muted-foreground"}`}
            >
              Entrar
            </button>
            <button
              type="button"
              onClick={() => setMode("signup")}
              className={`flex-1 py-2 rounded-md text-sm font-medium transition ${isSignup ? "bg-background shadow-sm" : "text-muted-foreground"}`}
            >
              Criar conta
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {isSignup && (
              <div>
                <label className="block text-sm font-medium mb-1.5">Como devemos te chamar?</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full rounded-lg border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder="Seu primeiro nome"
                />
              </div>
            )}
            <div>
              <label className="block text-sm font-medium mb-1.5">Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="voce@prestativa.com.br"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5">Senha</label>
              <input
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="••••••••"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg gradient-primary text-primary-foreground font-medium py-2.5 hover:opacity-90 transition disabled:opacity-50"
            >
              {loading ? (isSignup ? "Criando…" : "Entrando…") : isSignup ? "Criar conta e entrar" : "Entrar"}
            </button>
          </form>
          <p className="text-xs text-muted-foreground text-center mt-6">
            {isSignup ? "Após criar a conta, personalize seu avatar em 4 passos." : "Acesso por convite. Fale com a administração para receber seu login."}
          </p>
        </div>

        <p className="text-xs text-center text-muted-foreground mt-6">
          <Link to="/" className="hover:text-foreground transition">← Voltar</Link>
        </p>
      </div>
    </div>
  );
}
