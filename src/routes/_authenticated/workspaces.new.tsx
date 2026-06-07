import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { OFFICE_THEMES } from "@/lib/office-themes";
import {
  createWorkspace,
  suggestSlug,
  type SeedSource,
} from "@/lib/workspace/create";
import { toast } from "sonner";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Sparkles,
  Loader2,
  Building2,
  Palette,
  Map as MapIcon,
  ClipboardCheck,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/workspaces/new")({
  head: () => ({ meta: [{ title: "Novo escritório — Prestativa Office" }] }),
  component: NewWorkspacePage,
});

type Step = 1 | 2 | 3 | 4;

function NewWorkspacePage() {
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);
  const [allowed, setAllowed] = useState(false);

  const [step, setStep] = useState<Step>(1);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [description, setDescription] = useState("");
  const [themeId, setThemeId] = useState(OFFICE_THEMES[0].id);
  const [seedFrom, setSeedFrom] = useState<SeedSource>("blank");
  const [sourceWorkspaceId, setSourceWorkspaceId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) {
        navigate({ to: "/auth" });
        return;
      }
      const { data: roles } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", u.user.id);
      const isAdmin = (roles ?? []).some((r: any) => r.role === "admin");
      setAllowed(isAdmin);
      try {
        const last = localStorage.getItem("lastWorkspaceId");
        if (last) setSourceWorkspaceId(last);
      } catch {}
      setChecking(false);
    })();
  }, [navigate]);

  useEffect(() => {
    if (!slugTouched) setSlug(name ? suggestSlug(name) : "");
  }, [name, slugTouched]);

  const selectedTheme = useMemo(
    () => OFFICE_THEMES.find((t) => t.id === themeId) ?? OFFICE_THEMES[0],
    [themeId]
  );

  const canNext = useMemo(() => {
    if (step === 1) return name.trim().length >= 2 && slug.trim().length >= 2;
    if (step === 3 && seedFrom === "current" && !sourceWorkspaceId) return false;
    return true;
  }, [step, name, slug, seedFrom, sourceWorkspaceId]);

  const submit = async () => {
    setSubmitting(true);
    const result = await createWorkspace({
      name,
      slug,
      description: description || null,
      themeId,
      seedFrom,
      sourceWorkspaceId,
    });
    setSubmitting(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success("Escritório criado!");
    try {
      localStorage.setItem("lastWorkspaceId", result.workspaceId);
    } catch {}
    navigate({
      to: "/workspaces/$workspaceId",
      params: { workspaceId: result.workspaceId },
    });
  };

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">
        Carregando…
      </div>
    );
  }

  if (!allowed) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-background via-accent/20 to-background flex items-center justify-center px-6">
        <div className="glass-panel rounded-2xl p-8 max-w-md text-center">
          <Sparkles className="mx-auto mb-3 text-muted-foreground" />
          <h1 className="text-lg font-semibold mb-1">Sem permissão</h1>
          <p className="text-sm text-muted-foreground mb-5">
            Só administradores podem criar novos escritórios.
          </p>
          <button
            onClick={() => navigate({ to: "/workspaces" })}
            className="px-4 py-2 rounded-lg gradient-primary text-primary-foreground text-sm font-medium"
          >
            Voltar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-accent/20 to-background">
      <div className="max-w-3xl mx-auto px-6 py-10">
        <button
          onClick={() => navigate({ to: "/workspaces" })}
          className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 mb-6"
        >
          <ArrowLeft size={14} /> Voltar para Seus escritórios
        </button>

        <h1 className="text-3xl font-semibold tracking-tight mb-2">
          Novo escritório
        </h1>
        <p className="text-sm text-muted-foreground mb-8">
          Configure um novo espaço sem afetar o escritório atual. Cada
          escritório tem seu próprio mapa, tema, áreas e equipe.
        </p>

        <Stepper step={step} />

        <div className="glass-panel rounded-2xl p-6 mt-6">
          {step === 1 && (
            <StepIdentity
              name={name}
              setName={setName}
              slug={slug}
              setSlug={(v) => {
                setSlugTouched(true);
                setSlug(v);
              }}
              description={description}
              setDescription={setDescription}
            />
          )}
          {step === 2 && (
            <StepTheme themeId={themeId} setThemeId={setThemeId} />
          )}
          {step === 3 && (
            <StepSeed
              seedFrom={seedFrom}
              setSeedFrom={setSeedFrom}
              hasSource={!!sourceWorkspaceId}
            />
          )}
          {step === 4 && (
            <StepReview
              name={name}
              slug={slug}
              description={description}
              theme={selectedTheme}
              seedFrom={seedFrom}
            />
          )}
        </div>

        <div className="flex items-center justify-between mt-6">
          <button
            onClick={() => setStep((s) => (Math.max(1, s - 1) as Step))}
            disabled={step === 1}
            className="px-4 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground disabled:opacity-30"
          >
            Voltar
          </button>
          {step < 4 ? (
            <button
              onClick={() => setStep((s) => (Math.min(4, s + 1) as Step))}
              disabled={!canNext}
              className="px-5 py-2.5 rounded-lg gradient-primary text-primary-foreground text-sm font-medium inline-flex items-center gap-2 disabled:opacity-50"
            >
              Avançar <ArrowRight size={14} />
            </button>
          ) : (
            <button
              onClick={submit}
              disabled={submitting}
              className="px-5 py-2.5 rounded-lg gradient-primary text-primary-foreground text-sm font-medium inline-flex items-center gap-2 disabled:opacity-50"
            >
              {submitting ? (
                <>
                  <Loader2 size={14} className="animate-spin" /> Criando…
                </>
              ) : (
                <>
                  <Check size={14} /> Criar escritório
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Stepper({ step }: { step: Step }) {
  const steps = [
    { n: 1, label: "Identidade", icon: Building2 },
    { n: 2, label: "Tema", icon: Palette },
    { n: 3, label: "Mapa inicial", icon: MapIcon },
    { n: 4, label: "Revisão", icon: ClipboardCheck },
  ];
  return (
    <div className="flex items-center gap-2">
      {steps.map((s, i) => {
        const active = step === s.n;
        const done = step > s.n;
        const Icon = s.icon;
        return (
          <div key={s.n} className="flex items-center gap-2 flex-1">
            <div
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                active
                  ? "bg-primary text-primary-foreground"
                  : done
                  ? "bg-primary/15 text-primary"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              <Icon size={14} /> {s.label}
            </div>
            {i < steps.length - 1 && (
              <div className={`h-px flex-1 ${done ? "bg-primary/40" : "bg-border"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function StepIdentity({
  name,
  setName,
  slug,
  setSlug,
  description,
  setDescription,
}: {
  name: string;
  setName: (v: string) => void;
  slug: string;
  setSlug: (v: string) => void;
  description: string;
  setDescription: (v: string) => void;
}) {
  return (
    <div className="space-y-4">
      <div>
        <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Nome do escritório
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ex.: Prestativa SP"
          className="mt-1 w-full px-3 py-2 rounded-lg bg-background border border-border focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
      </div>
      <div>
        <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Identificador (slug)
        </label>
        <input
          type="text"
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          placeholder="prestativa-sp"
          className="mt-1 w-full px-3 py-2 rounded-lg bg-background border border-border focus:outline-none focus:ring-2 focus:ring-primary/40 font-mono text-sm"
        />
      </div>
      <div>
        <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Descrição (opcional)
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          placeholder="Para que serve este escritório?"
          className="mt-1 w-full px-3 py-2 rounded-lg bg-background border border-border focus:outline-none focus:ring-2 focus:ring-primary/40 resize-none"
        />
      </div>
    </div>
  );
}

function StepTheme({
  themeId,
  setThemeId,
}: {
  themeId: string;
  setThemeId: (id: string) => void;
}) {
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-3">
        Escolha o tema visual
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        {OFFICE_THEMES.map((t) => {
          const active = t.id === themeId;
          return (
            <button
              key={t.id}
              onClick={() => setThemeId(t.id)}
              className={`text-left rounded-xl overflow-hidden border-2 transition ${
                active
                  ? "border-primary shadow-glow"
                  : "border-transparent hover:border-primary/40"
              }`}
            >
              <div className="aspect-video bg-muted">
                <img
                  src={t.url}
                  alt={t.label}
                  className="w-full h-full object-cover"
                />
              </div>
              <div className="p-3">
                <div className="flex items-center justify-between mb-1">
                  <div className="font-medium text-sm">{t.label}</div>
                  {active && <Check size={14} className="text-primary" />}
                </div>
                {t.description && (
                  <div className="text-xs text-muted-foreground line-clamp-2">
                    {t.description}
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function StepSeed({
  seedFrom,
  setSeedFrom,
  hasSource,
}: {
  seedFrom: SeedSource;
  setSeedFrom: (s: SeedSource) => void;
  hasSource: boolean;
}) {
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-3">
        Ponto de partida do mapa
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        Áreas, paredes e props podem ser ajustados depois pelo Editor de
        Escritório dentro do novo espaço.
      </p>
      <div className="space-y-2">
        <SeedOption
          active={seedFrom === "blank"}
          onClick={() => setSeedFrom("blank")}
          title="Começar em branco"
          desc="Mapa vazio. Você desenha as áreas e posiciona os móveis do zero."
        />
        <SeedOption
          active={seedFrom === "current"}
          onClick={() => setSeedFrom("current")}
          disabled={!hasSource}
          title="Copiar do escritório atual"
          desc={
            hasSource
              ? "Clona o mapa, áreas e props do seu escritório atual. Bom para variações."
              : "Indisponível: nenhum escritório atual identificado."
          }
        />
      </div>
    </div>
  );
}

function SeedOption({
  active,
  onClick,
  title,
  desc,
  disabled,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  desc: string;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`w-full text-left p-4 rounded-xl border-2 transition disabled:opacity-50 disabled:cursor-not-allowed ${
        active
          ? "border-primary bg-primary/5"
          : "border-border hover:border-primary/40"
      }`}
    >
      <div className="flex items-center justify-between mb-1">
        <div className="font-medium text-sm">{title}</div>
        {active && <Check size={14} className="text-primary" />}
      </div>
      <div className="text-xs text-muted-foreground">{desc}</div>
    </button>
  );
}

function StepReview({
  name,
  slug,
  description,
  theme,
  seedFrom,
}: {
  name: string;
  slug: string;
  description: string;
  theme: { label: string; url: string };
  seedFrom: SeedSource;
}) {
  return (
    <div className="space-y-4">
      <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        Revise e confirme
      </div>
      <div className="rounded-xl overflow-hidden border border-border">
        <div className="aspect-video bg-muted">
          <img src={theme.url} alt="" className="w-full h-full object-cover" />
        </div>
        <div className="p-4 space-y-2">
          <Row label="Nome" value={name} />
          <Row label="Slug" value={slug} mono />
          {description && <Row label="Descrição" value={description} />}
          <Row label="Tema" value={theme.label} />
          <Row
            label="Mapa inicial"
            value={
              seedFrom === "blank"
                ? "Em branco"
                : "Copiado do escritório atual"
            }
          />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Depois de criar, você será levado direto para o novo escritório e
        poderá ajustar áreas e móveis no Editor de Escritório.
      </p>
    </div>
  );
}

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className={`text-sm text-right ${mono ? "font-mono" : ""}`}>
        {value}
      </div>
    </div>
  );
}
