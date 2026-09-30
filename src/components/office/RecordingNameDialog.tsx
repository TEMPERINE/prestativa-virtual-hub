import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Pedido de nome para a gravação, exibido só depois que o Egress terminou
 * e apenas para quem iniciou. Dispensar não bloqueia nada: a reunião fica
 * com o nome padrão e pode ser renomeada em "Minhas reuniões".
 */
export function RecordingNameDialog({
  meetingId,
  defaultTitle,
  onClose,
}: {
  meetingId: string;
  defaultTitle: string;
  onClose: () => void;
}) {
  const [value, setValue] = useState(defaultTitle);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const title = value.trim();
    if (!title) return onClose();
    setSaving(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any).rpc("meeting_set_title", {
        _meeting_id: meetingId,
        _title: title,
      });
      if (error) throw error;
      toast.success("Gravação salva como “" + title + "”");
      onClose();
    } catch {
      toast.error("Não consegui salvar o nome. Você pode renomear em Minhas reuniões.");
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Gravação concluída</DialogTitle>
          <DialogDescription>
            Dê um nome para encontrá-la depois em Minhas reuniões. Você pode renomear a
            qualquer momento.
          </DialogDescription>
        </DialogHeader>
        <Input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void save();
          }}
          placeholder="Nome da reunião"
          maxLength={120}
        />
        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Agora não
          </Button>
          <Button onClick={() => void save()} disabled={saving}>
            {saving ? "Salvando…" : "Salvar nome"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
