import { createFileRoute } from "@tanstack/react-router";

/**
 * Webhook do LiveKit (egress_started / egress_updated / egress_ended).
 * Assinatura verificada com LIVEKIT_API_KEY/SECRET antes de qualquer escrita.
 */
export const Route = createFileRoute("/api/public/livekit-egress")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = await request.text();
        const auth = request.headers.get("authorization") ?? "";
        const srv = await import("@/lib/meetings/egress.server");
        let event;
        try {
          const lk = srv.readLiveKit();
          const { WebhookReceiver } = await import("livekit-server-sdk");
          event = await new WebhookReceiver(lk.apiKey, lk.apiSecret).receive(body, auth);
        } catch {
          return new Response("invalid signature", { status: 401 });
        }
        if (event.egressInfo && event.event.startsWith("egress_")) {
          await srv.applyEgressInfo(event.egressInfo);
        }
        return new Response("ok");
      },
    },
  },
});
