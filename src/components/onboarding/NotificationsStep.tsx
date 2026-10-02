import { useEffect, useState } from "react";
import { BellRing } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { OfficeNotificationService, OfficePermission } from "@/lib/notifications/notification-service";

/** Etapa "Não perca nenhum chamado" — só pede permissão no clique. */
export function NotificationsStep({ service }: { service: OfficeNotificationService }) {
  const [perm, setPerm] = useState<OfficePermission>("default");
  const [busy, setBusy] = useState(false);
  useEffect(() => { setPerm(service.getPermission()); }, [service]);

  const activate = async () => {
    setBusy(true);
    try { setPerm(await service.requestPermission()); } finally { setBusy(false); }
  };

  return (
    <div className="text-center space-y-4 py-6">
      <BellRing className="h-12 w-12 mx-auto text-primary" />
      <h2 className="text-2xl font-semibold">Não perca nenhum chamado</h2>
      <p className="text-muted-foreground max-w-md mx-auto">
        O Prestativa Office pode avisar você quando alguém chamar sua atenção, mesmo enquanto estiver trabalhando em outra aba.
      </p>
      {perm === "granted" && service.isOptedIn() ? (
        <p className="text-sm font-medium text-primary">✓ Notificações ativadas</p>
      ) : perm === "denied" ? (
        <p className="text-sm text-muted-foreground max-w-md mx-auto">
          As notificações do sistema estão desativadas. Você ainda receberá os avisos dentro do Office.
          Para ativá-las, altere a permissão nas configurações do navegador.
        </p>
      ) : perm === "unsupported" ? (
        <p className="text-sm text-muted-foreground">Este navegador não suporta notificações. Você receberá os avisos dentro do Office.</p>
      ) : (
        <Button onClick={activate} disabled={busy}>{busy ? "Aguardando…" : "Ativar notificações"}</Button>
      )}
    </div>
  );
}
