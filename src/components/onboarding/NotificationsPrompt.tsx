import { useState } from "react";
import { Button } from "@/components/ui/button";
import { NotificationsStep } from "./NotificationsStep";
import { createWebNotificationAdapter } from "@/lib/notifications/web-notification-adapter";
import { markNotificationSetupDone, type OfficeNotificationService } from "@/lib/notifications/notification-service";

/** Usuários já onboarded: só a nova etapa, uma única vez. Não mexe em personagem. */
export function NotificationsPrompt({ userId, onDone, notificationService }: { userId: string; onDone: () => void; notificationService?: OfficeNotificationService }) {
  const [service] = useState(() => notificationService ?? createWebNotificationAdapter());
  const close = () => { markNotificationSetupDone(userId); onDone(); };
  return (
    <div className="fixed inset-0 z-[200] bg-background/80 backdrop-blur-sm flex items-center justify-center p-6">
      <div className="w-full max-w-lg glass-panel rounded-2xl shadow-soft p-8">
        <NotificationsStep service={service} />
        <div className="flex justify-end mt-6">
          <Button variant="ghost" onClick={close}>Continuar</Button>
        </div>
      </div>
    </div>
  );
}
