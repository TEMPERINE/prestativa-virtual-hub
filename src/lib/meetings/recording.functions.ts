import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const Input = z.object({ meetingId: z.string().uuid() });

/**
 * URL temporária da gravação (WebM antigo no Cloud ou MP4 V2 no S3/R2).
 * Só para quem participou da reunião ou é administrador.
 */
export const getRecordingUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: meeting } = await (supabaseAdmin as any)
      .from("meetings")
      .select("id, workspace_id, recording_path")
      .eq("id", data.meetingId)
      .maybeSingle();
    if (!meeting?.recording_path) return { ok: false as const, code: "NO_RECORDING" };

    const sb = context.supabase;
    const [part, wsAdmin, admin, master] = await Promise.all([
      sb.rpc("is_meeting_participant", { _meeting_id: meeting.id, _user_id: context.userId }),
      sb.rpc("is_workspace_admin", { _workspace_id: meeting.workspace_id, _user_id: context.userId }),
      sb.rpc("has_role", { _user_id: context.userId, _role: "admin" }),
      sb.rpc("has_role", { _user_id: context.userId, _role: "master" }),
    ]);
    if (!part.data && !wsAdmin.data && !admin.data && !master.data) {
      return { ok: false as const, code: "FORBIDDEN" };
    }

    const store = await import("./recording-storage.server");
    const backend = await store.resolveRecordingBackend(meeting.id, meeting.recording_path);
    try {
      const url = await store.getRecordingSignedUrl(backend, meeting.recording_path);
      return { ok: true as const, url, backend, expiresIn: store.SIGNED_URL_TTL_SECONDS };
    } catch (e) {
      const code = e instanceof Error && e.message === "STORAGE_NOT_CONFIGURED" ? "STORAGE_NOT_CONFIGURED" : "SIGN_FAILED";
      return { ok: false as const, code };
    }
  });
