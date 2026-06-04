import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const SWATCHES = ["#E94B8C", "#9b5cf6", "#22c55e", "#f59e0b", "#0ea5e9", "#ef4444", "#a3a3a3", "#14b8a6"];

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  userId: string;
  initial: { display_name: string; avatar_color: string; tagline: string | null };
  onSaved: () => void;
};

export function EditProfileModal({ open, onOpenChange, userId, initial, onSaved }: Props) {
  const [name, setName] = useState(initial.display_name);
  const [color, setColor] = useState(initial.avatar_color);
  const [tagline, setTagline] = useState(initial.tagline ?? "");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed) { toast.error("Coloque um nome."); return; }
    setSaving(true);
    const { error } = await supabase
      .from("profiles")
      .update({ display_name: trimmed.slice(0, 24), avatar_color: color, tagline: tagline.trim().slice(0, 80) || null })
      .eq("id", userId);
    setSaving(false);
    if (error) { toast.error("Falha ao salvar."); return; }
    toast.success("Perfil atualizado!");
    onSaved();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar perfil</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium block mb-1.5">Nome do avatar</label>
            <input
              value={name}
              maxLength={24}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
            />
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
          <div className="rounded-lg p-3 flex items-center gap-2" style={{ background: `${color}1a` }}>
            <span className="text-xs text-muted-foreground">Preview:</span>
            <span className="px-2 py-0.5 rounded text-white text-xs font-medium" style={{ background: color }}>
              {name || "Seu nome"}
            </span>
            {tagline && <span className="text-xs italic text-muted-foreground">"{tagline}"</span>}
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
