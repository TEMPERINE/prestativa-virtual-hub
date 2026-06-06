import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { supabase } from "@/integrations/supabase/client";
import {
  ArrowLeft, Users, Clock, Video, Sparkles, Loader2, FileText, ChevronDown,
  Folder, FolderPlus, FolderOpen, Inbox, Pencil, Trash2, FolderInput,
  Search, Star, Download, Check, X, AlertCircle, CheckCircle2,
} from "lucide-react";
import { generateMeetingAi } from "@/lib/meetings/ai.functions";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuCheckboxItem, DropdownMenuSeparator, DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";

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

type FolderRow = { id: string; name: string };
type FolderItemRow = { folder_id: string; meeting_id: string };

/** "all" | "unfiled" | "favorites" | uuid de pasta */
type FolderSel = "all" | "unfiled" | "favorites" | string;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

function MeetingsPage() {
  const [loading, setLoading] = useState(true);
  const [meetings, setMeetings] = useState<MeetingRow[]>([]);
  const [participantsByMeeting, setParticipantsByMeeting] = useState<
    Record<string, ParticipantRow[]>
  >({});
  const [profiles, setProfiles] = useState<Record<string, { display_name: string; avatar_color: string }>>({});
  const [folders, setFolders] = useState<FolderRow[]>([]);
  const [folderItems, setFolderItems] = useState<FolderItemRow[]>([]);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<FolderSel>("all");
  const [userId, setUserId] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth.user?.id ?? null;
      setUserId(uid);

      const [{ data: ms }, { data: fs }, { data: fis }, { data: favs }] = await Promise.all([
        supabase
          .from("meetings" as never)
          .select("id, zone_id, zone_label, title, started_at, ended_at, host_id, recording_path, recording_duration_seconds, transcript, summary, ai_status, ai_error")
          .order("started_at", { ascending: false })
          .limit(200),
        sb.from("meeting_folders").select("id, name").order("name"),
        sb.from("meeting_folder_items").select("folder_id, meeting_id"),
        sb.from("meeting_favorites").select("meeting_id"),
      ]);
      if (cancelled) return;
      const meetingList = (ms ?? []) as MeetingRow[];
      setMeetings(meetingList);
      setFolders((fs ?? []) as FolderRow[]);
      setFolderItems((fis ?? []) as FolderItemRow[]);
      setFavorites(new Set(((favs ?? []) as { meeting_id: string }[]).map((f) => f.meeting_id)));

      if (meetingList.length > 0) {
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
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const foldersByMeeting = useMemo(() => {
    const m: Record<string, Set<string>> = {};
    for (const fi of folderItems) {
      (m[fi.meeting_id] ??= new Set()).add(fi.folder_id);
    }
    return m;
  }, [folderItems]);

  const countsByFolder = useMemo(() => {
    const c: Record<string, number> = {};
    for (const fi of folderItems) c[fi.folder_id] = (c[fi.folder_id] ?? 0) + 1;
    return c;
  }, [folderItems]);

  const unfiledCount = useMemo(
    () => meetings.filter((m) => !foldersByMeeting[m.id] || foldersByMeeting[m.id].size === 0).length,
    [meetings, foldersByMeeting],
  );

  const visibleMeetings = useMemo(() => {
    let base: MeetingRow[];
    if (selected === "all") base = meetings;
    else if (selected === "favorites") base = meetings.filter((m) => favorites.has(m.id));
    else if (selected === "unfiled") base = meetings.filter((m) => !foldersByMeeting[m.id] || foldersByMeeting[m.id].size === 0);
    else base = meetings.filter((m) => foldersByMeeting[m.id]?.has(selected));

    const q = query.trim().toLowerCase();
    if (!q) return base;
    return base.filter((m) => {
      const hay = [m.title ?? "", m.zone_label, m.summary ?? "", m.transcript ?? ""]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [meetings, foldersByMeeting, favorites, selected, query]);

  // CRUD pastas
  const createFolder = async () => {
    const name = window.prompt("Nome da nova pasta:")?.trim();
    if (!name || !userId) return;
    const { data, error } = await sb
      .from("meeting_folders")
      .insert({ user_id: userId, name })
      .select("id, name")
      .single();
    if (error) { alert(error.message); return; }
    setFolders((prev) => [...prev, data as FolderRow].sort((a, b) => a.name.localeCompare(b.name)));
    setSelected((data as FolderRow).id);
  };

  const renameFolder = async (f: FolderRow) => {
    const name = window.prompt("Renomear pasta:", f.name)?.trim();
    if (!name || name === f.name) return;
    const { error } = await sb.from("meeting_folders").update({ name }).eq("id", f.id);
    if (error) return alert(error.message);
    setFolders((prev) => prev.map((x) => (x.id === f.id ? { ...x, name } : x)).sort((a, b) => a.name.localeCompare(b.name)));
  };

  const deleteFolder = async (f: FolderRow) => {
    if (!window.confirm(`Excluir a pasta "${f.name}"? As reuniões continuam no histórico.`)) return;
    const { error } = await sb.from("meeting_folders").delete().eq("id", f.id);
    if (error) return alert(error.message);
    setFolders((prev) => prev.filter((x) => x.id !== f.id));
    setFolderItems((prev) => prev.filter((x) => x.folder_id !== f.id));
    if (selected === f.id) setSelected("all");
  };

  const toggleMembership = async (meetingId: string, folderId: string, isMember: boolean) => {
    if (!userId) return;
    if (isMember) {
      const { error } = await sb
        .from("meeting_folder_items")
        .delete()
        .eq("meeting_id", meetingId)
        .eq("folder_id", folderId);
      if (error) return alert(error.message);
      setFolderItems((prev) => prev.filter((fi) => !(fi.meeting_id === meetingId && fi.folder_id === folderId)));
    } else {
      const { error } = await sb
        .from("meeting_folder_items")
        .insert({ user_id: userId, meeting_id: meetingId, folder_id: folderId });
      if (error) return alert(error.message);
      setFolderItems((prev) => [...prev, { folder_id: folderId, meeting_id: meetingId }]);
    }
  };

  const toggleFavorite = async (meetingId: string) => {
    if (!userId) return;
    const isFav = favorites.has(meetingId);
    if (isFav) {
      const { error } = await sb
        .from("meeting_favorites")
        .delete()
        .eq("user_id", userId)
        .eq("meeting_id", meetingId);
      if (error) return alert(error.message);
      setFavorites((prev) => { const n = new Set(prev); n.delete(meetingId); return n; });
    } else {
      const { error } = await sb
        .from("meeting_favorites")
        .insert({ user_id: userId, meeting_id: meetingId });
      if (error) return alert(error.message);
      setFavorites((prev) => new Set(prev).add(meetingId));
    }
  };

  const renameMeeting = async (meetingId: string, newTitle: string) => {
    const trimmed = newTitle.trim();
    const { error } = await sb.rpc("meeting_set_title", {
      _meeting_id: meetingId,
      _title: trimmed,
    });
    if (error) { alert(error.message); return; }
    setMeetings((prev) =>
      prev.map((m) => (m.id === meetingId ? { ...m, title: trimmed || null } : m)),
    );
  };

  const currentTitle =
    selected === "all" ? "Minhas reuniões"
    : selected === "favorites" ? "Favoritas"
    : selected === "unfiled" ? "Sem pasta"
    : folders.find((f) => f.id === selected)?.name ?? "Pasta";

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b sticky top-0 bg-background/90 backdrop-blur z-10">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center gap-3">
          <Link
            to="/office"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="w-4 h-4" />
            Voltar ao escritório
          </Link>
          <div className="ml-auto flex items-center gap-3">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar em títulos, resumos…"
                className="pl-8 pr-3 py-1.5 text-sm rounded-md border bg-background w-64 focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            </div>
            <div className="text-sm font-semibold">{currentTitle}</div>
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 py-6 flex gap-6">
        <FolderExplorer
          folders={folders}
          selected={selected}
          onSelect={setSelected}
          allCount={meetings.length}
          favoritesCount={favorites.size}
          unfiledCount={unfiledCount}
          countsByFolder={countsByFolder}
          onCreate={createFolder}
          onRename={renameFolder}
          onDelete={deleteFolder}
        />

        <main className="flex-1 min-w-0">
          {loading ? (
            <div className="text-sm text-muted-foreground">Carregando…</div>
          ) : visibleMeetings.length === 0 ? (
            <EmptyState selected={selected} hasQuery={!!query.trim()} />
          ) : (
            <ul className="space-y-3">
              {visibleMeetings.map((m) => (
                <MeetingCard
                  key={m.id}
                  meeting={m}
                  participants={participantsByMeeting[m.id] ?? []}
                  hostProfile={m.host_id ? profiles[m.host_id] : undefined}
                  folders={folders}
                  meetingFolderIds={foldersByMeeting[m.id] ?? new Set()}
                  isFavorite={favorites.has(m.id)}
                  onToggleFavorite={() => toggleFavorite(m.id)}
                  onRename={(t) => renameMeeting(m.id, t)}
                  onToggleFolder={(folderId, isMember) => toggleMembership(m.id, folderId, isMember)}
                  onCreateFolder={createFolder}
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
    </div>
  );
}

function FolderExplorer({
  folders, selected, onSelect, allCount, favoritesCount, unfiledCount, countsByFolder,
  onCreate, onRename, onDelete,
}: {
  folders: FolderRow[];
  selected: FolderSel;
  onSelect: (s: FolderSel) => void;
  allCount: number;
  favoritesCount: number;
  unfiledCount: number;
  countsByFolder: Record<string, number>;
  onCreate: () => void;
  onRename: (f: FolderRow) => void;
  onDelete: (f: FolderRow) => void;
}) {
  return (
    <aside className="w-56 shrink-0">
      <div className="sticky top-20">
        <div className="flex items-center justify-between mb-2 px-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Pastas</span>
          <button
            onClick={onCreate}
            title="Nova pasta"
            className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
          >
            <FolderPlus className="w-4 h-4" />
          </button>
        </div>
        <nav className="space-y-0.5">
          <FolderItem
            icon={<Inbox className="w-4 h-4" />}
            label="Minhas reuniões"
            count={allCount}
            active={selected === "all"}
            onClick={() => onSelect("all")}
          />
          <FolderItem
            icon={<Star className={`w-4 h-4 ${selected === "favorites" ? "fill-current" : ""}`} />}
            label="Favoritas"
            count={favoritesCount}
            active={selected === "favorites"}
            onClick={() => onSelect("favorites")}
          />
          {folders.map((f) => (
            <FolderItem
              key={f.id}
              icon={selected === f.id ? <FolderOpen className="w-4 h-4" /> : <Folder className="w-4 h-4" />}
              label={f.name}
              count={countsByFolder[f.id] ?? 0}
              active={selected === f.id}
              onClick={() => onSelect(f.id)}
              onRename={() => onRename(f)}
              onDelete={() => onDelete(f)}
            />
          ))}
          {unfiledCount > 0 && (
            <FolderItem
              icon={<Folder className="w-4 h-4 opacity-50" />}
              label="Sem pasta"
              count={unfiledCount}
              active={selected === "unfiled"}
              onClick={() => onSelect("unfiled")}
              muted
            />
          )}
        </nav>
      </div>
    </aside>
  );
}

function FolderItem({
  icon, label, count, active, onClick, onRename, onDelete, muted,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  onRename?: () => void;
  onDelete?: () => void;
  muted?: boolean;
}) {
  return (
    <div
      className={`group flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer ${
        active ? "bg-primary/10 text-primary" : muted ? "text-muted-foreground hover:bg-muted/50" : "hover:bg-muted/50"
      }`}
      onClick={onClick}
    >
      <span className="shrink-0">{icon}</span>
      <span className="flex-1 text-sm truncate">{label}</span>
      <span className="text-xs text-muted-foreground tabular-nums">{count}</span>
      {(onRename || onDelete) && (
        <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5">
          {onRename && (
            <button
              onClick={(e) => { e.stopPropagation(); onRename(); }}
              className="p-0.5 rounded hover:bg-background"
              title="Renomear"
            >
              <Pencil className="w-3 h-3" />
            </button>
          )}
          {onDelete && (
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(); }}
              className="p-0.5 rounded hover:bg-background text-destructive"
              title="Excluir"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function EmptyState({ selected, hasQuery }: { selected: FolderSel; hasQuery: boolean }) {
  if (hasQuery) {
    return (
      <div className="border border-dashed rounded-xl p-10 text-center">
        <Search className="w-8 h-8 mx-auto text-muted-foreground mb-3" />
        <div className="font-semibold mb-1">Nada encontrado</div>
        <div className="text-sm text-muted-foreground">Tente outros termos ou limpe a busca.</div>
      </div>
    );
  }
  return (
    <div className="border border-dashed rounded-xl p-10 text-center">
      <Video className="w-8 h-8 mx-auto text-muted-foreground mb-3" />
      <div className="font-semibold mb-1">
        {selected === "all" ? "Nenhuma reunião por aqui ainda"
        : selected === "favorites" ? "Sem favoritas ainda"
        : "Esta pasta está vazia"}
      </div>
      <div className="text-sm text-muted-foreground">
        {selected === "all"
          ? "Entre numa sala de reunião com pelo menos mais uma pessoa para começar seu histórico."
          : selected === "favorites"
          ? "Toque na estrela em qualquer reunião para favoritar."
          : "Mova reuniões para esta pasta usando o botão de pasta no card."}
      </div>
    </div>
  );
}

function MeetingCard({
  meeting,
  participants,
  hostProfile,
  folders,
  meetingFolderIds,
  isFavorite,
  onToggleFavorite,
  onRename,
  onToggleFolder,
  onCreateFolder,
  onAiUpdated,
}: {
  meeting: MeetingRow;
  participants: ParticipantRow[];
  hostProfile?: { display_name: string; avatar_color: string };
  folders: FolderRow[];
  meetingFolderIds: Set<string>;
  isFavorite: boolean;
  onToggleFavorite: () => void;
  onRename: (newTitle: string) => void;
  onToggleFolder: (folderId: string, isMember: boolean) => void;
  onCreateFolder: () => void;
  onAiUpdated: (transcript: string, summary: string) => void;
}) {
  const start = new Date(meeting.started_at);
  const end = meeting.ended_at ? new Date(meeting.ended_at) : null;
  const durationMin = end
    ? Math.max(1, Math.round((end.getTime() - start.getTime()) / 60000))
    : null;
  const isLive = !end;
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(meeting.title ?? meeting.zone_label);
  const hasContent = !!(meeting.recording_path || meeting.summary || meeting.transcript);

  const commitRename = () => {
    setEditing(false);
    const next = draft.trim();
    const current = meeting.title ?? "";
    if (next === current) return;
    onRename(next);
  };

  return (
    <li className="border rounded-xl bg-card overflow-hidden">
      <div className="p-4 flex items-start gap-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          disabled={!hasContent}
          aria-expanded={open}
          aria-label={open ? "Recolher reunião" : "Expandir reunião"}
          className={`mt-1 p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted shrink-0 transition-colors ${hasContent ? "" : "opacity-30 cursor-default"}`}
        >
          <ChevronDown
            className={`w-4 h-4 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          />
        </button>
        <div
          className="w-10 h-10 rounded-lg flex items-center justify-center text-white shrink-0 cursor-pointer"
          style={{ background: hostProfile?.avatar_color ?? "#475569" }}
          onClick={() => hasContent && setOpen((v) => !v)}
        >
          <Video className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            {editing ? (
              <div className="flex items-center gap-1 flex-1 min-w-0">
                <input
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename();
                    if (e.key === "Escape") { setDraft(meeting.title ?? meeting.zone_label); setEditing(false); }
                  }}
                  className="flex-1 min-w-0 text-sm font-semibold border rounded px-2 py-0.5 focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
                <button onClick={commitRename} className="p-1 text-emerald-600 hover:bg-muted rounded" title="Salvar">
                  <Check className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => { setDraft(meeting.title ?? meeting.zone_label); setEditing(false); }}
                  className="p-1 text-muted-foreground hover:bg-muted rounded"
                  title="Cancelar"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => hasContent && setOpen((v) => !v)}
                  className="font-semibold truncate text-left hover:underline"
                >
                  {meeting.title ?? meeting.zone_label}
                </button>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setDraft(meeting.title ?? meeting.zone_label); setEditing(true); }}
                  className="p-0.5 text-muted-foreground hover:text-foreground rounded"
                  title="Renomear reunião"
                >
                  <Pencil className="w-3 h-3" />
                </button>
              </>
            )}
            {isLive && (
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Em andamento
              </span>
            )}
            <div className="ml-auto flex items-center gap-1">
              <button
                onClick={onToggleFavorite}
                title={isFavorite ? "Remover dos favoritos" : "Favoritar"}
                className={`p-1 rounded hover:bg-muted ${isFavorite ? "text-amber-500" : "text-muted-foreground hover:text-foreground"}`}
              >
                <Star className={`w-4 h-4 ${isFavorite ? "fill-current" : ""}`} />
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground border rounded px-2 py-1">
                  <FolderInput className="w-3 h-3" />
                  {meetingFolderIds.size > 0
                    ? `${meetingFolderIds.size} pasta${meetingFolderIds.size === 1 ? "" : "s"}`
                    : "Mover para pasta"}
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel className="text-xs">Organizar em pastas</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {folders.length === 0 && (
                    <div className="px-2 py-1.5 text-xs text-muted-foreground">
                      Nenhuma pasta ainda.
                    </div>
                  )}
                  {folders.map((f) => {
                    const isMember = meetingFolderIds.has(f.id);
                    return (
                      <DropdownMenuCheckboxItem
                        key={f.id}
                        checked={isMember}
                        onCheckedChange={() => onToggleFolder(f.id, isMember)}
                        onSelect={(e) => e.preventDefault()}
                      >
                        {f.name}
                      </DropdownMenuCheckboxItem>
                    );
                  })}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={onCreateFolder}>
                    <FolderPlus className="w-3 h-3 mr-2" /> Nova pasta…
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
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
            <AiStatusBadge meeting={meeting} />
          </div>

          <div
            className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}
          >
            <div className="overflow-hidden">
              {meeting.recording_path && (
                <RecordingPlayer
                  path={meeting.recording_path}
                  durationSec={meeting.recording_duration_seconds ?? null}
                  active={open}
                />
              )}

              {meeting.recording_path && (
                <AiPanel meeting={meeting} onAiUpdated={onAiUpdated} />
              )}

              <PersonalNotes meetingId={meeting.id} active={open} />

            </div>
          </div>
        </div>
      </div>
    </li>
  );
}

function AiStatusBadge({ meeting }: { meeting: MeetingRow }) {
  const status = meeting.ai_status;
  const hasAi = !!(meeting.summary || meeting.transcript);
  if (hasAi && status !== "error") {
    return (
      <span className="inline-flex items-center gap-1 text-emerald-700">
        <CheckCircle2 className="w-3 h-3" /> Resumo pronto
      </span>
    );
  }
  if (status === "processing") {
    return (
      <span className="inline-flex items-center gap-1 text-primary">
        <Loader2 className="w-3 h-3 animate-spin" /> Gerando resumo…
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className="inline-flex items-center gap-1 text-destructive">
        <AlertCircle className="w-3 h-3" /> Falha no resumo
      </span>
    );
  }
  if (meeting.recording_path) {
    return (
      <span className="inline-flex items-center gap-1 text-muted-foreground">
        <Sparkles className="w-3 h-3" /> Pendente
      </span>
    );
  }
  return null;
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

function downloadText(filename: string, content: string, mime = "text/markdown;charset=utf-8") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function safeFilename(s: string): string {
  return s.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, "_").slice(0, 80) || "reuniao";
}

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
      // erro fica salvo em meeting.ai_error via servidor
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (triedRef.current) return;
    if (hasAi) return;
    if (meeting.ai_status === "error") return;
    triedRef.current = true;
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meeting.id]);

  const baseName = safeFilename(meeting.title ?? meeting.zone_label);
  const dateStr = new Date(meeting.started_at).toISOString().slice(0, 10);

  const exportSummary = () => {
    if (!meeting.summary) return;
    const header = `# ${meeting.title ?? meeting.zone_label}\n\n_${new Date(meeting.started_at).toLocaleString("pt-BR")}_\n\n`;
    downloadText(`${dateStr}_${baseName}_resumo.md`, header + meeting.summary);
  };

  const exportTranscript = () => {
    if (!meeting.transcript) return;
    const header = `# Transcrição — ${meeting.title ?? meeting.zone_label}\n\n_${new Date(meeting.started_at).toLocaleString("pt-BR")}_\n\n`;
    downloadText(`${dateStr}_${baseName}_transcricao.md`, header + meeting.transcript);
  };

  return (
    <div className="mt-3 border-t pt-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
        <Sparkles className="w-3 h-3" />
        <span>Resumo automático</span>
        <div className="ml-auto flex items-center gap-2">
          {busy ? (
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <Loader2 className="w-3 h-3 animate-spin" /> Gerando…
            </span>
          ) : hasAi ? (
            <>
              <button
                onClick={exportSummary}
                className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
                title="Baixar resumo (.md)"
              >
                <Download className="w-3 h-3" /> Resumo
              </button>
              <button
                onClick={() => void run()}
                className="text-primary hover:underline"
              >
                Refazer
              </button>
            </>
          ) : meeting.ai_status === "error" ? (
            <button
              onClick={() => void run()}
              className="text-primary hover:underline"
            >
              Tentar novamente
            </button>
          ) : null}
        </div>
      </div>
      {meeting.ai_error && !busy && (
        <div className="text-xs text-destructive mb-2 inline-flex items-center gap-1">
          <AlertCircle className="w-3 h-3" /> {meeting.ai_error}
        </div>
      )}
      {busy && !meeting.summary && (
        <div className="text-sm bg-muted/40 rounded-md p-4 space-y-2 animate-pulse">
          <div className="h-3 bg-muted rounded w-3/4" />
          <div className="h-3 bg-muted rounded w-full" />
          <div className="h-3 bg-muted rounded w-5/6" />
          <div className="h-3 bg-muted rounded w-2/3" />
        </div>
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
          <div className="flex items-center gap-3">
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
            <button
              onClick={exportTranscript}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              title="Baixar transcrição (.md)"
            >
              <Download className="w-3 h-3" /> Transcrição
            </button>
          </div>
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
  active = true,
}: {
  path: string;
  durationSec: number | null;
  active?: boolean;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    if (url || loading) return;
    setLoading(true);
    const { data, error } = await supabase.storage
      .from("meeting-recordings")
      .createSignedUrl(path, 60 * 60);
    setLoading(false);
    if (error || !data?.signedUrl) return;
    setUrl(data.signedUrl);
  };

  useEffect(() => {
    if (!active) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, active]);

  return (
    <div className="mt-3 border-t pt-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
        <Video className="w-3 h-3" />
        <span>Gravação{durationSec ? ` · ${formatDur(durationSec)}` : ""}</span>
        {url && (
          <a
            href={url}
            download
            className="ml-auto inline-flex items-center gap-1 text-primary hover:underline"
          >
            <Download className="w-3 h-3" /> Baixar vídeo
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
        <div className="text-xs text-muted-foreground inline-flex items-center gap-1">
          {loading ? <><Loader2 className="w-3 h-3 animate-spin" /> Carregando gravação…</> : "Gravação indisponível."}
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
