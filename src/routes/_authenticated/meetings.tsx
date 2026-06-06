import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { supabase } from "@/integrations/supabase/client";
import { ArrowLeft, Users, Clock, Video, Sparkles, Loader2, FileText, ChevronDown } from "lucide-react";
import { generateMeetingAi } from "@/lib/meetings/ai.functions";

export const Route = createFileRoute("/_authenticated/meetings")({
  head: () => ({
    meta: [
      { title: "Minhas Reuniões — Prestativa Office" },
      { name: "description", content: "Histórico das suas reuniões no escritório virtual." },
    ],
  }),
  component: MeetingsPage,
});

type MeetingRow = {
  id: string;
  zone_id: string;
  zone_label: string;
  title: string | null;
  started_at: string;
  ended_at: string | null;
  host_id: string | null;
  recording_path: string | null;
  recording_duration_seconds: number | null;
  transcript: string | null;
  summary: string | null;
  ai_status: string | null;
  ai_error: string | null;
};

type ParticipantRow = {
  meeting_id: string;
  user_id: string;
  joined_at: string;
  left_at: string | null;
  profiles?: { display_name: string; avatar_color: string } | null;
};

function MeetingsPage() {
  const [loading, setLoading] = useState(true);
  const [meetings, setMeetings] = useState<MeetingRow[]>([]);
  const [participantsByMeeting, setParticipantsByMeeting] = useState<
    Record<string, ParticipantRow[]>
  >({});
  const [profiles, setProfiles] = useState<Record<string, { display_name: string; avatar_color: string }>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      // RLS já filtra: o usuário só vê reuniões em que participou.
      const { data: ms } = await supabase
        .from("meetings" as never)
        .select("id, zone_id, zone_label, title, started_at, ended_at, host_id, recording_path, recording_duration_seconds, transcript, summary, ai_status, ai_error")
        .order("started_at", { ascending: false })
        .limit(100);
      if (cancelled) return;
      const meetingList = (ms ?? []) as MeetingRow[];
      setMeetings(meetingList);

      if (meetingList.length === 0) {
        setLoading(false);
        return;
      }

      // Pega participantes só das próprias reuniões (RLS filtra o resto: o
      // usuário só consegue ler os próprios registros). Pra mostrar a lista
      // completa de participantes, precisaríamos relaxar a RLS. Por ora
      // mostramos o total via host + perfis dos próprios registros.
      const ids = meetingList.map((m) => m.id);
      const { data: parts } = await supabase
        .from("meeting_participants" as never)
        .select("meeting_id, user_id, joined_at, left_at")
        .in("meeting_id", ids);
      const byMeeting: Record<string, ParticipantRow[]> = {};
      for (const p of (parts ?? []) as ParticipantRow[]) {
        (byMeeting[p.meeting_id] ??= []).push(p);
      }
      setParticipantsByMeeting(byMeeting);

      // Carrega nomes dos hosts
      const userIds = Array.from(
        new Set(meetingList.map((m) => m.host_id).filter(Boolean) as string[]),
      );
      if (userIds.length > 0) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("id, display_name, avatar_color")
          .in("id", userIds);
        const map: Record<string, { display_name: string; avatar_color: string }> = {};
        for (const p of profs ?? []) {
          map[p.id] = { display_name: p.display_name, avatar_color: p.avatar_color };
        }
        setProfiles(map);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b sticky top-0 bg-background/90 backdrop-blur z-10">
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center gap-3">
          <Link
            to="/office"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="w-4 h-4" />
            Voltar ao escritório
          </Link>
          <div className="ml-auto text-sm font-semibold">Minhas reuniões</div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6">
        {loading ? (
          <div className="text-sm text-muted-foreground">Carregando…</div>
        ) : meetings.length === 0 ? (
          <EmptyState />
        ) : (
          <ul className="space-y-3">
            {meetings.map((m) => (
              <MeetingCard
                key={m.id}
                meeting={m}
                participants={participantsByMeeting[m.id] ?? []}
                hostProfile={m.host_id ? profiles[m.host_id] : undefined}
                onAiUpdated={(transcript, summary) => {
                  setMeetings((prev) =>
                    prev.map((row) =>
                      row.id === m.id
                        ? { ...row, transcript, summary, ai_status: "done", ai_error: null }
                        : row,
                    ),
                  );
                }}
              />
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="border border-dashed rounded-xl p-10 text-center">
      <Video className="w-8 h-8 mx-auto text-muted-foreground mb-3" />
      <div className="font-semibold mb-1">Nenhuma reunião por aqui ainda</div>
      <div className="text-sm text-muted-foreground">
        Entre numa sala de reunião com pelo menos mais uma pessoa para começar
        seu histórico.
      </div>
    </div>
  );
}

function MeetingCard({
  meeting,
  participants,
  hostProfile,
  onAiUpdated,
}: {
  meeting: MeetingRow;
  participants: ParticipantRow[];
  hostProfile?: { display_name: string; avatar_color: string };
  onAiUpdated: (transcript: string, summary: string) => void;
}) {
  const start = new Date(meeting.started_at);
  const end = meeting.ended_at ? new Date(meeting.ended_at) : null;
  const durationMin = end
    ? Math.max(1, Math.round((end.getTime() - start.getTime()) / 60000))
    : null;
  const isLive = !end;

  return (
    <li className="border rounded-xl p-4 bg-card">
      <div className="flex items-start gap-3">
        <div
          className="w-10 h-10 rounded-lg flex items-center justify-center text-white shrink-0"
          style={{ background: hostProfile?.avatar_color ?? "#475569" }}
        >
          <Video className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <div className="font-semibold truncate">
              {meeting.title ?? meeting.zone_label}
            </div>
            {isLive && (
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Em andamento
              </span>
            )}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="inline-flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {start.toLocaleString("pt-BR", {
                day: "2-digit",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              })}
              {durationMin ? ` · ${durationMin} min` : ""}
            </span>
            <span className="inline-flex items-center gap-1">
              <Users className="w-3 h-3" />
              {participants.length || "—"} participação{participants.length === 1 ? "" : "s"} sua{participants.length === 1 ? "" : "s"}
            </span>
            <span className="text-muted-foreground/80">· {meeting.zone_label}</span>
          </div>

          {meeting.recording_path && (
            <RecordingPlayer
              path={meeting.recording_path}
              durationSec={meeting.recording_duration_seconds ?? null}
            />
          )}

          {meeting.recording_path && (
            <AiPanel meeting={meeting} onAiUpdated={onAiUpdated} />
          )}
        </div>
      </div>
    </li>
  );
}

const mdComponents = {
  h1: (p: any) => <h3 className="text-base font-semibold mt-3 mb-1" {...p} />,
  h2: (p: any) => <h3 className="text-base font-semibold mt-3 mb-1" {...p} />,
  h3: (p: any) => <h4 className="text-sm font-semibold mt-3 mb-1" {...p} />,
  h4: (p: any) => <h5 className="text-sm font-semibold mt-2 mb-1" {...p} />,
  p: (p: any) => <p className="my-1" {...p} />,
  ul: (p: any) => <ul className="list-disc pl-5 my-1 space-y-0.5" {...p} />,
  ol: (p: any) => <ol className="list-decimal pl-5 my-1 space-y-0.5" {...p} />,
  li: (p: any) => <li className="my-0" {...p} />,
  strong: (p: any) => <strong className="font-semibold" {...p} />,
  em: (p: any) => <em className="italic" {...p} />,
  a: (p: any) => <a className="text-primary hover:underline" {...p} />,
  code: (p: any) => <code className="px-1 py-0.5 rounded bg-muted text-[0.85em]" {...p} />,
};



function AiPanel({
  meeting,
  onAiUpdated,
}: {
  meeting: MeetingRow;
  onAiUpdated: (transcript: string, summary: string) => void;
}) {
  const generate = useServerFn(generateMeetingAi);
  const hasAi = !!(meeting.summary || meeting.transcript);
  const [busy, setBusy] = useState(meeting.ai_status === "processing" || (!hasAi && meeting.ai_status !== "error"));
  const [openTranscript, setOpenTranscript] = useState(false);
  const triedRef = useRef(false);

  const run = async () => {
    setBusy(true);
    try {
      const res = await generate({ data: { meetingId: meeting.id } });
      onAiUpdated(res.transcript, res.summary);
    } catch {
      // erro fica salvo em meeting.ai_error via servidor; refletido no próximo carregamento
    } finally {
      setBusy(false);
    }
  };

  // Auto-trigger: gera assim que o card aparece, se ainda não tem resumo.
  useEffect(() => {
    if (triedRef.current) return;
    if (hasAi) return;
    if (meeting.ai_status === "error") return;
    triedRef.current = true;
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meeting.id]);

  return (
    <div className="mt-3 border-t pt-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
        <Sparkles className="w-3 h-3" />
        <span>Resumo automático</span>
        {busy ? (
          <span className="ml-auto inline-flex items-center gap-1 text-muted-foreground">
            <Loader2 className="w-3 h-3 animate-spin" /> Gerando…
          </span>
        ) : hasAi ? (
          <button
            onClick={() => void run()}
            className="ml-auto text-primary hover:underline"
          >
            Refazer
          </button>
        ) : meeting.ai_status === "error" ? (
          <button
            onClick={() => void run()}
            className="ml-auto text-primary hover:underline"
          >
            Tentar novamente
          </button>
        ) : null}
      </div>
      {meeting.ai_error && !busy && (
        <div className="text-xs text-destructive mb-2">{meeting.ai_error}</div>
      )}
      {meeting.summary && (
        <div className="text-sm leading-relaxed bg-muted/40 rounded-md p-3">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
            {meeting.summary}
          </ReactMarkdown>
        </div>
      )}
      {meeting.transcript && (
        <div className="mt-2">
          <button
            onClick={() => setOpenTranscript((v) => !v)}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <FileText className="w-3 h-3" />
            {openTranscript ? "Esconder" : "Ver"} transcrição completa
            <ChevronDown
              className={`w-3 h-3 transition-transform ${openTranscript ? "rotate-180" : ""}`}
            />
          </button>
          {openTranscript && (
            <div className="mt-2 text-xs bg-muted/30 rounded-md p-3 max-h-96 overflow-auto">
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                {meeting.transcript}
              </ReactMarkdown>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function RecordingPlayer({
  path,
  durationSec,
}: {
  path: string;
  durationSec: number | null;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    if (url || loading) return;
    setLoading(true);
    const { data, error } = await supabase.storage
      .from("meeting-recordings")
      .createSignedUrl(path, 60 * 60); // 1h
    setLoading(false);
    if (error || !data?.signedUrl) return;
    setUrl(data.signedUrl);
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  return (
    <div className="mt-3 border-t pt-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
        <Video className="w-3 h-3" />
        <span>Gravação{durationSec ? ` · ${formatDur(durationSec)}` : ""}</span>
        {url && (
          <a
            href={url}
            download
            className="ml-auto text-primary hover:underline"
          >
            Baixar
          </a>
        )}
      </div>
      {url ? (
        <video
          controls
          src={url}
          className="w-full rounded-md bg-black aspect-video"
          preload="metadata"
        />
      ) : (
        <div className="text-xs text-muted-foreground">
          {loading ? "Carregando gravação…" : "Gravação indisponível."}
        </div>
      )}
    </div>
  );
}

function formatDur(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${String(s).padStart(2, "0")}s`;
}

