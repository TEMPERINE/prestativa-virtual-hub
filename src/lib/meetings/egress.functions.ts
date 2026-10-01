import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { roomNameFor } from "@/lib/rtc/room-names";

const StartInput = z.object({ meetingId: z.string().uuid() });

/** Inicia a gravação server-side da reunião (RoomComposite Egress + template). */
export const startServerRecording = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => StartInput.parse(d))
  .handler(async ({ data, context }) => {
    const srv = await import("./egress.server");
    const s3 = srv.readS3Config();
    if (!s3.ok) {
      return { ok: false as const, code: "STORAGE_NOT_CONFIGURED", missing: s3.missing };
    }
    // Autorização: precisa ser participante (RLS + função segura)
    const { data: isPart } = await context.supabase.rpc("is_meeting_participant", {
      _meeting_id: data.meetingId,
      _user_id: context.userId,
    });
    if (!isPart) return { ok: false as const, code: "NOT_PARTICIPANT" };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabaseAdmin as any;
    const { data: meeting } = await db
      .from("meetings")
      .select("id, workspace_id, zone_id, ended_at")
      .eq("id", data.meetingId)
      .maybeSingle();
    if (!meeting || meeting.ended_at) return { ok: false as const, code: "MEETING_NOT_ACTIVE" };

    // Permissão central (Membro Operacional não grava) — antes de qualquer Egress/registro.
    const { data: allowed } = await context.supabase.rpc("can_record_meeting", {
      _user_id: context.userId,
      _workspace_id: meeting.workspace_id,
    });
    if (!allowed) return { ok: false as const, code: "NOT_ALLOWED_TO_RECORD" };

    const roomName = roomNameFor(meeting.workspace_id, { kind: "PRIVATE_ROOM", zoneId: meeting.zone_id });
    if (!roomName) return { ok: false as const, code: "NO_ROOM" };

    const lk = srv.readLiveKit();
    const sdk = await import("livekit-server-sdk");

    // Confirma no servidor que o usuário está CONECTADO na Private Room.
    const rooms = new sdk.RoomServiceClient(lk.host, lk.apiKey, lk.apiSecret);
    const parts = await rooms.listParticipants(roomName).catch(() => []);
    if (!parts.some((p) => p.identity === context.userId || p.identity.startsWith(`${context.userId}:`))) {
      return { ok: false as const, code: "NOT_CONNECTED" };
    }

    const filePath = srv.recordingPath(meeting.id);
    // Reserva a gravação; o índice único impede duplicata simultânea.
    const { data: row, error: insErr } = await db
      .from("meeting_egress")
      .insert({
        meeting_id: meeting.id,
        workspace_id: meeting.workspace_id,
        room_name: roomName,
        started_by: context.userId,
        file_path: filePath,
        status: "starting",
      })
      .select("id")
      .single();
    if (insErr) {
      if (insErr.code === "23505") return { ok: false as const, code: "ALREADY_RECORDING" };
      throw new Error("Falha ao registrar gravação");
    }

    try {
      const egress = new sdk.EgressClient(lk.host, lk.apiKey, lk.apiSecret);
      const output = new sdk.EncodedFileOutput({
        fileType: sdk.EncodedFileType.MP4,
        filepath: filePath,
        output: {
          case: "s3",
          value: new sdk.S3Upload({
            endpoint: s3.cfg.endpoint,
            region: s3.cfg.region,
            bucket: s3.cfg.bucket,
            accessKey: s3.cfg.accessKey,
            secret: s3.cfg.secret,
            forcePathStyle: true,
          }),
        },
      });
      const info = await egress.startRoomCompositeEgress(roomName, output, {
        layout: "prestativa",
        customBaseUrl: srv.templateUrl(meeting.id),
      });
      await db.from("meeting_egress").update({ egress_id: info.egressId }).eq("id", row.id);
      await srv.applyEgressInfo(info);
      await context.supabase.rpc("meeting_mark_recording_started", { _meeting_id: meeting.id });
      return { ok: true as const, egressId: info.egressId };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await db
        .from("meeting_egress")
        .update({ status: "failed", error: msg.slice(0, 500), ended_at: new Date().toISOString() })
        .eq("id", row.id);
      return { ok: false as const, code: "EGRESS_START_FAILED" };
    }
  });

/** Para a gravação ativa da reunião. O arquivo é confirmado pelo webhook. */
export const stopServerRecording = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => StartInput.parse(d))
  .handler(async ({ data, context }) => {
    const { data: isPart } = await context.supabase.rpc("is_meeting_participant", {
      _meeting_id: data.meetingId,
      _user_id: context.userId,
    });
    if (!isPart) return { ok: false as const, code: "NOT_PARTICIPANT" };
    const srv = await import("./egress.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabaseAdmin as any;
    const { data: row } = await db
      .from("meeting_egress")
      .select("id, egress_id")
      .eq("meeting_id", data.meetingId)
      .in("status", ["starting", "active", "ending"])
      .maybeSingle();
    if (!row?.egress_id) return { ok: false as const, code: "NOT_RECORDING" };
    const { data: mtg } = await db.from("meetings").select("workspace_id").eq("id", data.meetingId).maybeSingle();
    const { data: allowed } = mtg
      ? await context.supabase.rpc("can_record_meeting", { _user_id: context.userId, _workspace_id: mtg.workspace_id })
      : { data: false };
    if (!allowed) return { ok: false as const, code: "NOT_ALLOWED_TO_RECORD" };
    await db.from("meeting_egress").update({ status: "ending", stopped_by: context.userId }).eq("id", row.id);
    try {
      const lk = srv.readLiveKit();
      const sdk = await import("livekit-server-sdk");
      const info = await new sdk.EgressClient(lk.host, lk.apiKey, lk.apiSecret).stopEgress(row.egress_id);
      await srv.applyEgressInfo(info);
    } catch {
      /* webhook confirma o estado final */
    }
    return { ok: true as const };
  });
