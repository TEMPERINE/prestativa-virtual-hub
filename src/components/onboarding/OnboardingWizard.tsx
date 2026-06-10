import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { SPRITES, groupSpritesByGender } from "@/lib/sprite-catalog";
import { SpritePreview } from "@/components/profile/SpritePreview";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

const SWATCHES = ["#E94B8C", "#9b5cf6", "#22c55e", "#f59e0b", "#0ea5e9", "#ef4444", "#14b8a6", "#a855f7"];
const TAGLINES = ["Bora codar! 💻", "Café primeiro ☕", "Foco total 🎯", "Bom dia, time! ☀️", "Energia lá em cima ⚡", "Modo zen 🧘"];
type Status = "available" | "busy" | "away";

type Props = {
  userId: string;
  initialName: string;
  onDone: () => void;
};

export function OnboardingWizard({ userId, initialName, onDone }: Props) {
  const [step, setStep] = useState(0);
  const [spriteId, setSpriteId] = useState(SPRITES[0].id);
  const [name, setName] = useState(initialName);
  const [color, setColor] = useState("#9b5cf6");
  const [tagline, setTagline] = useState("");
  const [status, setStatus] = useState<Status>("available");
  const [saving, setSaving] = useState(false);

  const finish = async () => {
    const trimmed = name.trim();
    if (!trimmed) { toast.error("Escolha um nome para o avatar."); setStep(2); return; }
    setSaving(true);
    const { error } = await supabase.from("profiles").update({
      sprite_id: spriteId,
      display_name: trimmed.slice(0, 24),
      avatar_color: color,
      tagline: tagline.trim().slice(0, 80) || null,
      status,
      onboarded_at: new Date().toISOString(),
    }).eq("id", userId);
    setSaving(false);
    if (error) { toast.error("Falha ao salvar perfil."); return; }
    toast.success(`Bem-vindo(a), ${trimmed}! 🎉`);
    onDone();
  };

  const next = () => setStep((s) => Math.min(3, s + 1));
  const prev = () => setStep((s) => Math.max(0, s - 1));

  return (
    <div className="fixed inset-0 z-[200] bg-background/95 backdrop-blur-sm flex items-center justify-center p-6 overflow-y-auto">
      <div className="w-full max-w-2xl glass-panel rounded-2xl shadow-soft p-8">
        <div className="flex items-center gap-2 mb-6">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex-1 h-1.5 rounded-full transition-all" style={{ background: i <= step ? color : "hsl(var(--muted))" }} />
          ))}
        </div>

        {step === 0 && (
          <div className="text-center space-y-4 py-8">
            <div className="text-5xl">👋</div>
            <h2 className="text-3xl font-semibold">Bem-vindo ao Prestativa Office</h2>
            <p className="text-muted-foreground">Vamos montar seu avatar em menos de 1 minuto. Você poderá mudar tudo depois pelo menu do perfil.</p>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-4">
            <h2 className="text-2xl font-semibold">Escolha seu personagem</h2>
            <p className="text-sm text-muted-foreground">Esse será você no espaço.</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
              {SPRITES.map((s) => {
                const sel = s.id === spriteId;
                return (
                  <button
                    key={s.id}
                    onClick={() => setSpriteId(s.id)}
                    className="flex flex-col items-center gap-2 p-3 rounded-xl transition-all"
                    style={{ background: sel ? `${color}22` : "hsl(var(--muted))", border: `2px solid ${sel ? color : "transparent"}` }}
                  >
                    <div className="h-24 flex items-end justify-center">
                      <SpritePreview spriteId={s.id} animate={sel} size={96} />
                    </div>
                    <span className="text-xs font-medium">{s.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <h2 className="text-2xl font-semibold">Seu nome e cor</h2>
            <div>
              <label className="text-sm font-medium block mb-1.5">Como devemos te chamar?</label>
              <input
                value={name}
                maxLength={24}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-lg border bg-background px-3 py-2.5 text-sm"
              />
            </div>
            <div>
              <label className="text-sm font-medium block mb-1.5">Cor do seu nome no mapa</label>
              <div className="flex items-center gap-2 flex-wrap">
                {SWATCHES.map((c) => (
                  <button
                    key={c}
                    onClick={() => setColor(c)}
                    className="w-8 h-8 rounded-full border-2"
                    style={{ background: c, borderColor: color === c ? "white" : "transparent", boxShadow: color === c ? `0 0 0 2px ${c}` : "none" }}
                  />
                ))}
                <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="w-10 h-10 rounded cursor-pointer" />
              </div>
            </div>
            <div className="flex items-center gap-3 p-3 rounded-lg" style={{ background: `${color}1a` }}>
              <SpritePreview spriteId={spriteId} size={56} />
              <span className="px-2 py-1 rounded text-white text-sm font-medium" style={{ background: color }}>{name || "Seu nome"}</span>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <h2 className="text-2xl font-semibold">Sua vibe</h2>
            <div>
              <label className="text-sm font-medium block mb-1.5">Frase favorita (opcional)</label>
              <input
                value={tagline}
                maxLength={80}
                onChange={(e) => setTagline(e.target.value)}
                placeholder="Ex: Bora codar! ☕"
                className="w-full rounded-lg border bg-background px-3 py-2.5 text-sm"
              />
              <div className="flex flex-wrap gap-1.5 mt-2">
                {TAGLINES.map((t) => (
                  <button key={t} onClick={() => setTagline(t)} className="text-xs px-2 py-1 rounded-full bg-muted hover:bg-muted/70">{t}</button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-sm font-medium block mb-1.5">Status inicial</label>
              <div className="flex gap-2">
                {(["available", "busy", "away"] as Status[]).map((s) => (
                  <button
                    key={s}
                    onClick={() => setStatus(s)}
                    className="flex-1 py-2 rounded-lg text-sm border-2 transition"
                    style={{ borderColor: status === s ? color : "transparent", background: status === s ? `${color}22` : "hsl(var(--muted))" }}
                  >
                    {s === "available" ? "🟢 Disponível" : s === "busy" ? "🔴 Ocupado" : "⚪ Ausente"}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between mt-8">
          <Button variant="ghost" onClick={prev} disabled={step === 0}>Voltar</Button>
          {step < 3 ? (
            <Button onClick={next} style={{ background: color }}>Próximo</Button>
          ) : (
            <Button onClick={finish} disabled={saving} style={{ background: color }}>{saving ? "Salvando…" : "Entrar no espaço 🚀"}</Button>
          )}
        </div>
      </div>
    </div>
  );
}
