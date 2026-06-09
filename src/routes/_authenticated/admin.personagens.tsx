import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { ArrowLeft, Trash2, Pencil } from "lucide-react";
import {
  adminListSkins,
  adminUpdateSkin,
  adminDeleteSkin,
} from "@/lib/admin/sprites.functions";
import { adminListWorkspacesFull } from "@/lib/admin/workspaces.functions";
import { invalidateSpriteCatalog } from "@/lib/sprites/useSpriteCatalog";


export const Route = createFileRoute("/_authenticated/admin/personagens")({
  ssr: false,
  head: () => ({ meta: [{ title: "Personagens — Admin" }] }),
  component: AdminPersonagensPage,
});

type Facing = "down" | "up" | "left" | "right";

type Skin = {
  id: string;
  label: string;
  gender: "m" | "f" | "n";
  workspace_id: string | null;
  workspace_name: string | null;
  sheets: Record<Facing, string>;
  dims: Record<Facing, { w: number; h: number }>;
  mirror_right_from_left: boolean;
};

type Ws = { id: string; name: string };

function publicUrlFor(path: string): string {
  if (path.startsWith("http")) return path;
  const { data } = supabase.storage.from("sprite-sheets").getPublicUrl(path);
  return data.publicUrl;
}

function AdminPersonagensPage() {
  const navigate = useNavigate();
  const listFn = useServerFn(adminListSkins);
  const wsListFn = useServerFn(adminListWorkspacesFull);
  const signFn = useServerFn(adminCreateSignedUploadUrls);
  const saveFn = useServerFn(adminSaveSkin);
  const updateFn = useServerFn(adminUpdateSkin);
  const deleteFn = useServerFn(adminDeleteSkin);

  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [skins, setSkins] = useState<Skin[]>([]);
  const [workspaces, setWorkspaces] = useState<Ws[]>([]);

  // form
  const [skinId, setSkinId] = useState("");
  const [label, setLabel] = useState("");
  const [gender, setGender] = useState<"m" | "f" | "n">("n");
  const [wsId, setWsId] = useState<string>("");
  const [mirrorRight, setMirrorRight] = useState(true);
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [outputs, setOutputs] = useState<FacingOutput[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"sheet" | "ai">("sheet");

  const check = async () => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) { navigate({ to: "/auth" }); return false; }
    const { data } = await supabase.from("user_roles").select("role")
      .eq("user_id", u.user.id).eq("role", "admin").maybeSingle();
    return !!data;
  };

  const load = async () => {
    setLoading(true);
    const ok = await check();
    setAllowed(ok);
    if (!ok) { setLoading(false); return; }
    try {
      const [s, w] = await Promise.all([listFn(), wsListFn()]);
      setSkins((s as any).skins);
      setWorkspaces((w as any).workspaces.map((x: any) => ({ id: x.id, name: x.name })));
    } catch (e: any) { toast.error(e?.message ?? "Erro"); }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!outputs || outputs.length === 0) {
      toast.error("Gere os PNGs no editor antes de salvar.");
      return;
    }
    setBusy(true);
    try {
      const facings = outputs.map((o) => o.facing);
      const { uploads } = (await signFn({ data: { skinId, facings } })) as any;

      const sheets: Record<Facing, string> = {} as any;
      const dims: Record<Facing, { w: number; h: number }> = {} as any;

      for (const out of outputs) {
        const u = uploads[out.facing];
        const file = new File([out.blob], `${out.facing}.png`, { type: "image/png" });
        const { error } = await supabase.storage
          .from("sprite-sheets")
          .uploadToSignedUrl(u.path, u.token, file, { contentType: "image/png" });
        if (error) throw new Error(`Falha enviando ${out.facing}: ${error.message}`);
        sheets[out.facing] = u.path;
        // cellW = width / 6 (sheet tem 6 frames)
        dims[out.facing] = { w: Math.round(out.width / 6), h: out.height };
      }
      if (mirrorRight && !sheets.right) {
        sheets.right = sheets.left;
        dims.right = dims.left;
      }

      await saveFn({
        data: {
          id: skinId,
          label,
          gender,
          workspaceId: wsId || null,
          sheets,
          dims,
          mirrorRightFromLeft: mirrorRight,
          mirrorLeftFromRight: false,
        },
      });
      toast.success("Personagem criado!");
      invalidateSpriteCatalog();
      setSkinId(""); setLabel(""); setWsId(""); setSourceFile(null); setOutputs(null);
      load();
    } catch (e: any) {
      toast.error(e?.message ?? "Erro ao criar");
    }
    setBusy(false);
  };

  const rename = async (s: Skin) => {
    const newLabel = prompt("Novo rótulo:", s.label);
    if (!newLabel || newLabel === s.label) return;
    try {
      await updateFn({ data: { id: s.id, label: newLabel } });
      invalidateSpriteCatalog();
      setSkins((p) => p.map((x) => x.id === s.id ? { ...x, label: newLabel } : x));
    } catch (e: any) { toast.error(e?.message ?? "Erro"); }
  };

  const moveToWs = async (s: Skin, newWsId: string) => {
    try {
      await updateFn({ data: { id: s.id, workspaceId: newWsId || null } });
      invalidateSpriteCatalog();
      load();
    } catch (e: any) { toast.error(e?.message ?? "Erro"); }
  };

  const remove = async (s: Skin) => {
    if (!confirm(`Excluir "${s.label}"?`)) return;
    try {
      await deleteFn({ data: { id: s.id } });
      invalidateSpriteCatalog();
      setSkins((p) => p.filter((x) => x.id !== s.id));
    } catch (e: any) { toast.error(e?.message ?? "Erro"); }
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">Carregando…</div>;
  if (!allowed) return <div className="min-h-screen flex items-center justify-center p-6"><div className="max-w-md text-center glass-panel rounded-2xl p-8"><h1 className="text-lg font-semibold mb-2">Acesso restrito</h1></div></div>;

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-accent/20 to-background">
      <div className="max-w-5xl mx-auto px-6 py-10">
        <button onClick={() => navigate({ to: "/admin" })}
          className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 mb-6">
          <ArrowLeft size={14} /> Voltar
        </button>
        <h1 className="text-3xl font-semibold tracking-tight mb-2">Personagens (skins)</h1>
        <p className="text-sm text-muted-foreground mb-6">
          Suba uma folha de sprite (PNG, 4 linhas × 6 colunas: down, up, left, right). O sistema fatia,
          remove o fundo, alinha pelo centro e pela linha do pé — tudo em 1 clique. Use "Ajustar manualmente"
          só se algum frame precisar de refino.
        </p>

        <div className="glass-panel rounded-2xl p-6 mb-10 border border-dashed">
          <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground mb-2">
            Novo personagem — temporariamente desativado
          </h2>
          <p className="text-xs text-muted-foreground leading-relaxed">
            O fluxo de criação de skins (upload de folha e geração com IA) está suspenso nesta fase de validação.
            Estamos focando o piloto na Prestativa com as 9 skins padrão. A função volta depois da escala.
          </p>
        </div>


        <div className="text-xs uppercase tracking-wider text-muted-foreground mb-3">
          Personagens dinâmicos ({skins.length})
        </div>
        {skins.length === 0 && (
          <div className="text-sm text-muted-foreground italic">
            Nenhum personagem dinâmico ainda. As 9 skins padrão (Márcio, Loira, etc.) continuam disponíveis automaticamente.
          </div>
        )}
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {skins.map((s) => (
            <div key={s.id} className="glass-panel rounded-xl p-4">
              <div className="flex items-start gap-3">
                <img src={publicUrlFor(s.sheets.down)} alt={s.label}
                  className="w-16 h-24 object-cover rounded bg-muted"
                  style={{ objectPosition: "left top", objectFit: "none" }} />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm">{s.label}</div>
                  <div className="text-[11px] text-muted-foreground font-mono truncate">{s.id}</div>
                  <div className="text-[10px] uppercase tracking-wider mt-1">
                    {s.workspace_id ? (
                      <span className="px-1.5 py-0.5 rounded bg-primary/15 text-primary">{s.workspace_name}</span>
                    ) : (
                      <span className="px-1.5 py-0.5 rounded bg-muted">Global</span>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1.5 mt-3">
                <select value={s.workspace_id ?? ""} onChange={(e) => moveToWs(s, e.target.value)}
                  className="flex-1 rounded-lg border bg-background px-2 py-1 text-xs">
                  <option value="">Global</option>
                  {workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
                <button onClick={() => rename(s)} title="Renomear"
                  className="p-1.5 rounded-lg bg-muted hover:bg-muted/70"><Pencil size={12} /></button>
                <button onClick={() => remove(s)} title="Excluir"
                  className="p-1.5 rounded-lg bg-muted hover:bg-red-500/10 hover:text-red-500"><Trash2 size={12} /></button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
