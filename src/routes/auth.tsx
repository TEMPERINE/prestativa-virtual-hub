import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import logoAsset from "@/assets/prestativa-logo-v2.jpg.asset.json";
import bgAsset from "@/assets/auth-bg.jpg.asset.json";

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
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Bem-vindo(a) ao Virtual Office!");
    window.location.href = "/workspaces";
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center p-6 bg-[#faf9f8] bg-cover bg-center bg-no-repeat relative"
      style={{ backgroundImage: `url(${bgAsset.url})` }}
    >
      <div className="absolute inset-0 bg-black/45" aria-hidden />
      <div className="w-full max-w-md relative z-10">
        <div className="text-center mb-8">
          <img
            src={logoAsset.url}
            alt="Prestativa Vídeos"
            className="mx-auto h-40 w-auto object-contain mb-4 drop-shadow-[0_8px_24px_rgba(229,9,20,0.18)]"
          />
          <p className="text-sm text-muted-foreground mt-2">
            Seu espaço virtual. Presença, proximidade, colaboração.
          </p>
        </div>

        <div className="glass-panel rounded-2xl p-8 shadow-soft">
          <form onSubmit={handleSubmit} className="space-y-4">
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
              {loading ? "Entrando…" : "Entrar"}
            </button>
          </form>
          <p className="text-xs text-muted-foreground text-center mt-6">
            Acesso por convite. Fale com a administração para receber seu login.
          </p>
        </div>

        <p className="text-xs text-center text-muted-foreground mt-6">
          <Link to="/" className="hover:text-foreground transition">← Voltar</Link>
        </p>
      </div>
    </div>
  );
}
