import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const Input = z.object({
  roomName: z.string().min(1).max(200).regex(/^[a-zA-Z0-9_:.\-]+$/),
  userId: z.string().uuid(),
});

export const getLiveKitAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data, context }) => {
    if (data.userId !== context.userId) {
      throw new Error("Sessão da chamada não corresponde ao personagem atual. Recarregue o espaço.");
    }

    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    const url = process.env.LIVEKIT_URL;
    if (!apiKey || !apiSecret || !url) {
      throw new Error("LiveKit não configurado (LIVEKIT_URL/KEY/SECRET ausentes)");
    }

    const { data: prof } = await context.supabase
      .from("profiles")
      .select("display_name")
      .eq("id", context.userId)
      .maybeSingle();

    const { AccessToken } = await import("livekit-server-sdk");
    const at = new AccessToken(apiKey, apiSecret, {
      identity: context.userId,
      name: prof?.display_name ?? "Convidado",
      ttl: "6h",
    });
    at.addGrant({
      room: data.roomName,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });
    const token = await at.toJwt();
    return { url, token };
  });
