import { createFileRoute } from "@tanstack/react-router";

/**
 * Webhook do LiveKit (egress_started / egress_updated / egress_ended).
 * Assinatura verificada sobre o corpo RAW (request.text()) antes de qualquer parse/escrita.
 */
export const Route = createFileRoute("/api/public/livekit-egress")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const rawBody = await request.text();
        const srv = await import("@/lib/meetings/egress.server");
        const auth = srv.extractWebhookToken(request.headers);
        const log = (o: Record<string, unknown>) => console.log("[livekit-webhook]", JSON.stringify(o));
        let event;
        try {
          const lk = srv.readLiveKit();
          const { WebhookReceiver } = await import("livekit-server-sdk");
          event = await new WebhookReceiver(lk.apiKey, lk.apiSecret).receive(rawBody, auth.token, false, 60);
          log({
            ok: true,
            header: auth.source,
            bodyLen: rawBody.length,
            key4: lk.apiKey.slice(-4),
            event: event.event,
            egressId: event.egressInfo?.egressId ?? null,
          });
        } catch (e) {
          log({
            ok: false,
            header: auth.source,
            hadBearer: auth.hadBearer,
            bodyLen: rawBody.length,
            reason: (e instanceof Error ? e.message : String(e)).slice(0, 200),
          });
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
