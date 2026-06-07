import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { COUNTRIES, countryFlag, ageFromBirthDate } from "@/lib/countries";

const SWATCHES = ["#E94B8C", "#9b5cf6", "#22c55e", "#f59e0b", "#0ea5e9", "#ef4444", "#a3a3a3", "#14b8a6"];

export type EditProfileInitial = {
  display_name: string;
  avatar_color: string;
  tagline: string | null;
  first_name?: string | null;
  last_name?: string | null;
  birth_date?: string | null;
  city?: string | null;
  state?: string | null;
  country_code?: string | null;
};

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  userId: string;
  initial: EditProfileInitial;
  onSaved: () => void;
};

export function EditProfileModal({ open, onOpenChange, userId, initial, onSaved }: Props) {
  const [name, setName] = useState(initial.display_name);
  const [color, setColor] = useState(initial.avatar_color);
  const [tagline, setTagline] = useState(initial.tagline ?? "");
  const [firstName, setFirstName] = useState(initial.first_name ?? "");
  const [lastName, setLastName] = useState(initial.last_name ?? "");
  const [birthDate, setBirthDate] = useState(initial.birth_date ?? "");
  const [city, setCity] = useState(initial.city ?? "");
  const [state, setState] = useState(initial.state ?? "");
  const [countryCode, setCountryCode] = useState(initial.country_code ?? "BR");
  const [saving, setSaving] = useState(false);

  const age = ageFromBirthDate(birthDate || null);

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed) { toast.error("Coloque um nome."); return; }
    setSaving(true);
    const { error } = await supabase
      .from("profiles")
      .update({
        display_name: trimmed.slice(0, 24),
        avatar_color: color,
        tagline: tagline.trim().slice(0, 80) || null,
        first_name: firstName.trim().slice(0, 40) || null,
        last_name: lastName.trim().slice(0, 60) || null,
        birth_date: birthDate || null,
        city: city.trim().slice(0, 60) || null,
        state: state.trim().slice(0, 40) || null,
        country_code: countryCode ? countryCode.toUpperCase().slice(0, 2) : null,
      })
      .eq("id", userId);
    setSaving(false);
    if (error) { toast.error("Falha ao salvar."); return; }
    toast.success("Perfil atualizado!");
    onSaved();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Editar perfil</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium block mb-1.5">Nome do avatar (apelido)</label>
            <input
              value={name}
              maxLength={24}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium block mb-1.5">Nome</label>
              <input
                value={firstName}
                maxLength={40}
                onChange={(e) => setFirstName(e.target.value)}
                className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-sm font-medium block mb-1.5">Sobrenome</label>
              <input
                value={lastName}
                maxLength={60}
                onChange={(e) => setLastName(e.target.value)}
                className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium block mb-1.5">Data de aniversário</label>
              <input
                type="date"
                value={birthDate}
                onChange={(e) => setBirthDate(e.target.value)}
                className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-sm font-medium block mb-1.5">Idade</label>
              <div className="rounded-lg border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                {age !== null ? `${age} anos` : "—"}
              </div>
            </div>
          </div>
          <div className="grid grid-cols-[1fr_120px_120px] gap-3">
            <div>
              <label className="text-sm font-medium block mb-1.5">Cidade</label>
              <input
                value={city}
                maxLength={60}
                onChange={(e) => setCity(e.target.value)}
                className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-sm font-medium block mb-1.5">Estado/UF</label>
              <input
                value={state}
                maxLength={40}
                onChange={(e) => setState(e.target.value)}
                placeholder="SP"
                className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-sm font-medium block mb-1.5">País</label>
              <div className="flex items-center gap-1.5">
                <span className="text-xl leading-none">{countryFlag(countryCode) || "🌎"}</span>
                <select
                  value={countryCode}
                  onChange={(e) => setCountryCode(e.target.value)}
                  className="flex-1 rounded-lg border bg-background px-2 py-2 text-sm"
                >
                  {COUNTRIES.map((c) => (
                    <option key={c.code} value={c.code}>{c.code} — {c.name}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
          <div>
            <label className="text-sm font-medium block mb-1.5">Cor do nome</label>
            <div className="flex items-center gap-2 flex-wrap">
              {SWATCHES.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className="w-7 h-7 rounded-full border-2"
                  style={{ background: c, borderColor: color === c ? "white" : "transparent", boxShadow: color === c ? `0 0 0 2px ${c}` : "none" }}
                />
              ))}
              <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="w-9 h-9 rounded cursor-pointer" />
            </div>
          </div>
          <div>
            <label className="text-sm font-medium block mb-1.5">Frase favorita</label>
            <input
              value={tagline}
              maxLength={80}
              onChange={(e) => setTagline(e.target.value)}
              placeholder="Ex: Bora codar! ☕"
              className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
            />
          </div>
          <div className="rounded-lg p-3 flex items-center gap-2 flex-wrap" style={{ background: `${color}1a` }}>
            <span className="text-xs text-muted-foreground">Preview:</span>
            <span className="px-2 py-0.5 rounded text-white text-xs font-medium" style={{ background: color }}>
              {name || "Seu nome"}
            </span>
            {(city || state) && (
              <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
                {countryFlag(countryCode)} {[city, state].filter(Boolean).join(", ")}
              </span>
            )}
            {age !== null && <span className="text-xs text-muted-foreground">• {age} anos</span>}
            {tagline && <span className="text-xs italic text-muted-foreground w-full">"{tagline}"</span>}
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Salvando…" : "Salvar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
