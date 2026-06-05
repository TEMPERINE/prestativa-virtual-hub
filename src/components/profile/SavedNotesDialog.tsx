import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Trash2, StickyNote } from "lucide-react";
import { toast } from "sonner";

type SavedNote = {
  id: string;
  sender_id: string;
  sender_name: string | null;
  body: string;
  original_created_at: string;
  saved_at: string;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
};

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export function SavedNotesDialog({ open, onOpenChange, userId }: Props) {
  const [notes, setNotes] = useState<SavedNote[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const cutoff = new Date(Date.now() - THIRTY_DAYS_MS).toISOString();
      // Purga local: apaga recadinhos guardados há mais de 30 dias
      await supabase.from("saved_notes").delete().eq("user_id", userId).lt("saved_at", cutoff);
      const { data } = await supabase
        .from("saved_notes")
        .select("id, sender_id, sender_name, body, original_created_at, saved_at")
        .eq("user_id", userId)
        .gte("saved_at", cutoff)
        .order("saved_at", { ascending: false });
      if (cancelled) return;
      setNotes((data ?? []) as SavedNote[]);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [open, userId]);

  const remove = async (id: string) => {
    const { error } = await supabase.from("saved_notes").delete().eq("id", id);
    if (error) { toast.error("Não foi possível excluir."); return; }
    setNotes((p) => p.filter((n) => n.id !== id));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <StickyNote className="w-4 h-4" /> Recadinhos guardados
          </DialogTitle>
          <DialogDescription>
            Guardados ficam disponíveis aqui por até 30 dias.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] overflow-y-auto space-y-3 py-2">
          {loading && <div className="text-sm text-muted-foreground text-center py-6">Carregando…</div>}
          {!loading && notes.length === 0 && (
            <div className="text-sm text-muted-foreground text-center py-6">
              Você ainda não guardou nenhum recadinho.
            </div>
          )}
          {notes.map((n) => {
            const when = new Date(n.original_created_at).toLocaleDateString("pt-BR", {
              day: "2-digit", month: "short", year: "numeric",
            });
            return (
              <div
                key={n.id}
                className="rounded-lg p-3 shadow-soft relative"
                style={{
                  background: "linear-gradient(180deg, #FFE680 0%, #FFD84D 100%)",
                  color: "#3a2e00",
                }}
              >
                <div className="text-xs font-semibold opacity-80 mb-1">
                  {n.sender_name ?? "Alguém"} · {when}
                </div>
                <div className="whitespace-pre-wrap text-sm">{n.body}</div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => remove(n.id)}
                  className="absolute top-1.5 right-1.5 h-7 w-7 p-0 text-[#3a2e00] hover:bg-black/10"
                  title="Excluir guardado"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
