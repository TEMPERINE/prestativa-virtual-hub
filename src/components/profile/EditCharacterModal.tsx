import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { SPRITES, groupSpritesByGender } from "@/lib/sprite-catalog";
import { SpritePreview } from "./SpritePreview";
import { toast } from "sonner";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  userId: string;
  currentSpriteId: string;
  avatarColor: string;
  onSaved: () => void;
};

export function EditCharacterModal({ open, onOpenChange, userId, currentSpriteId, avatarColor, onSaved }: Props) {
  const [selected, setSelected] = useState(currentSpriteId);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    const { error } = await supabase.from("profiles").update({ sprite_id: selected }).eq("id", userId);
    setSaving(false);
    if (error) {
      toast.error("Não foi possível salvar o personagem.");
      return;
    }
    toast.success("Personagem atualizado!");
    onSaved();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Escolha seu personagem</DialogTitle>
        </DialogHeader>
        <div className="space-y-5 py-2 max-h-[60vh] overflow-y-auto pr-1">
          {groupSpritesByGender(SPRITES).map((group) => (
            <div key={group.key} className="space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-1">
                {group.label}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
                {group.items.map((s) => {
                  const isSel = s.id === selected;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setSelected(s.id)}
                      className="flex flex-col items-center gap-2 p-3 rounded-xl transition-all"
                      style={{
                        background: isSel ? `${avatarColor}22` : "hsl(var(--muted))",
                        border: `2px solid ${isSel ? avatarColor : "transparent"}`,
                      }}
                    >
                      <div className="h-24 flex items-end justify-center">
                        <SpritePreview spriteId={s.id} animate={isSel} size={96} />
                      </div>
                      <span className="text-xs font-medium">{s.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Salvando…" : "Salvar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
