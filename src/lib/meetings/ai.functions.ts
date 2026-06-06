import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const Input = z.object({ meetingId: z.string().uuid() });

/**
 * Baixa a gravação da reunião, manda pro Lovable AI Gateway (Gemini)
 * pedindo transcrição em português + um resumo executivo, e salva
 * tudo de volta na linha do `meetings`.
 *
 * Requer que o usuário seja participante (a RPC `meeting_mark_ai_processing`
 * faz essa checagem).
 */
export const generateMeetingAi = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data, context }) => {
    const { meetingId } = data;
    const { supabase } = context;

    // 1) Confere participação + carrega a linha
    const { data: meeting, error: mErr } = await supabase
      .from("meetings")
      .select("id, recording_path, ai_status")
      .eq("id", meetingId)
      .maybeSingle();
    if (mErr || !meeting) throw new Error("Reunião não encontrada.");
    if (!meeting.recording_path) throw new Error("Esta reunião não tem gravação.");

    // 2) Marca como processing (também valida participação via RPC)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    const { error: markErr } = await sb.rpc("meeting_mark_ai_processing", {
      _meeting_id: meetingId,
    });
    if (markErr) throw new Error(markErr.message ?? "Sem permissão.");

    // 3) Baixa o arquivo via admin (bucket é privado)
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: blob, error: dlErr } = await supabaseAdmin.storage
      .from("meeting-recordings")
      .download(meeting.recording_path);
    if (dlErr || !blob) {
      await sb.rpc("meeting_set_ai_error", {
        _meeting_id: meetingId,
        _error: "Não consegui baixar a gravação.",
      });
      throw new Error("Não consegui baixar a gravação.");
    }

    // 4) base64
    const buf = Buffer.from(await blob.arrayBuffer());
    if (buf.byteLength > 25 * 1024 * 1024) {
      const msg = "Gravação muito grande (limite 25 MB) para transcrição automática.";
      await sb.rpc("meeting_set_ai_error", { _meeting_id: meetingId, _error: msg });
      throw new Error(msg);
    }
    const base64 = buf.toString("base64");
    const mime = blob.type || "video/webm";

    // 5) Lovable AI Gateway — Gemini 2.5 Flash aceita áudio/vídeo inline.
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("LOVABLE_API_KEY ausente no servidor.");

    const prompt = `Você recebeu a gravação de uma reunião de trabalho (em português do Brasil).
1. Transcreva tudo o que foi dito, com falantes anônimos como "Pessoa 1", "Pessoa 2" etc. Inclua timestamps aproximados a cada bloco quando possível.
2. Em seguida, gere um resumo executivo curto com: tópicos discutidos, decisões tomadas e itens de ação (com responsável quando mencionado).

Responda **apenas** com um JSON válido neste formato exato:
{"transcript": "...texto da transcrição...", "summary": "...resumo em markdown..."}`;

    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              {
                type: "file",
                file: { file_data: `data:${mime};base64,${base64}`, filename: "meeting.webm" },
              },
            ],
          },
        ],
      }),
    });

    if (!aiRes.ok) {
      const txt = await aiRes.text().catch(() => "");
      const msg = `IA falhou (${aiRes.status}): ${txt.slice(0, 200)}`;
      await sb.rpc("meeting_set_ai_error", { _meeting_id: meetingId, _error: msg });
      throw new Error(msg);
    }

    const json = await aiRes.json();
    const text: string = json?.choices?.[0]?.message?.content ?? "";

    // Extrai JSON do texto (modelo pode adicionar ```json fences)
    let transcript = "";
    let summary = "";
    try {
      const match = text.match(/\{[\s\S]*\}/);
      const parsed = JSON.parse(match ? match[0] : text);
      transcript = String(parsed.transcript ?? "").trim();
      summary = String(parsed.summary ?? "").trim();
    } catch {
      transcript = "";
      summary = text.trim();
    }

    if (!transcript && !summary) {
      const msg = "Resposta da IA veio vazia.";
      await sb.rpc("meeting_set_ai_error", { _meeting_id: meetingId, _error: msg });
      throw new Error(msg);
    }

    const { error: saveErr } = await sb.rpc("meeting_set_ai_result", {
      _meeting_id: meetingId,
      _transcript: transcript,
      _summary: summary,
    });
    if (saveErr) throw new Error(saveErr.message ?? "Falha ao salvar.");

    return { ok: true as const, transcript, summary };
  });
