// Worker exclusivo de notificações do Prestativa Office.
// NÃO faz cache, NÃO intercepta requisições (sem handler "fetch") e é
// registrado num escopo estreito (/__office-notify/) — nunca controla as páginas do app.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("notificationclick", (event) => {
  const data = event.notification.data || {};
  event.notification.close();
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const office = all.find((c) => new URL(c.url).pathname.startsWith("/office")) || all[0];
      if (office) {
        try { await office.focus(); } catch (_) { /* ignore */ }
        // Só pede para reabrir o convite — nunca aceita nem move o avatar.
        office.postMessage({ type: "office-notify-click", tag: data.tag, fromUid: data.fromUid });
        return;
      }
      await self.clients.openWindow("/office");
    })(),
  );
});
