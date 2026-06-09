// Carrega skins dinâmicas do banco e mescla com o catálogo hard-coded.
// O componente AlignedSprite consulta o catálogo via getSprite/SPRITES;
// para usar dinâmicas, importe o catálogo merged daqui.

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { SPRITES, type SpriteDef, type Facing } from "@/lib/sprite-catalog";

type DbSkin = {
  id: string;
  label: string;
  gender: "m" | "f" | "n";
  workspace_id: string | null;
  sheets: Record<Facing, string>;
  dims: Record<Facing, { w: number; h: number }>;
  mirror_right_from_left: boolean;
  mirror_left_from_right: boolean;
};

function publicUrl(path: string): string {
  if (path.startsWith("http")) return path;
  const { data } = supabase.storage.from("sprite-sheets").getPublicUrl(path);
  return data.publicUrl;
}

function toSpriteDef(s: DbSkin): SpriteDef {
  const sheets: any = {};
  (Object.keys(s.sheets) as Facing[]).forEach((f) => {
    sheets[f] = publicUrl(s.sheets[f]);
  });
  // garante 4 facings (right pode ser espelhado)
  if (!sheets.right && sheets.left) sheets.right = sheets.left;
  if (!sheets.left && sheets.right) sheets.left = sheets.right;
  return {
    id: s.id,
    label: s.label,
    gender: s.gender,
    sheets,
    dims: s.dims,
    mirrorLeftFromRight: s.mirror_left_from_right,
    mirrorRightFromLeft: s.mirror_right_from_left,
  };
}

// Cache global em memória — evita refetch a cada render.
let _cache: SpriteDef[] | null = null;
const subs = new Set<() => void>();

async function loadDb(): Promise<SpriteDef[]> {
  const { data, error } = await supabase
    .from("sprite_skins" as any)
    .select("*");
  if (error || !data) return [];
  return (data as DbSkin[]).map(toSpriteDef);
}

export async function ensureSpriteCatalogLoaded(): Promise<SpriteDef[]> {
  if (_cache) return mergeCatalog(_cache);
  const dynamic = await loadDb();
  _cache = dynamic;
  subs.forEach((fn) => fn());
  return mergeCatalog(dynamic);
}

function mergeCatalog(dynamic: SpriteDef[]): SpriteDef[] {
  // hard-coded primeiro; dinâmicas se sobrepõem por id.
  const byId = new Map(SPRITES.map((s) => [s.id, s]));
  dynamic.forEach((s) => byId.set(s.id, s));
  return Array.from(byId.values());
}

export function useSpriteCatalog(workspaceId?: string | null): SpriteDef[] {
  const [, force] = useState(0);
  useEffect(() => {
    let mounted = true;
    if (!_cache) {
      ensureSpriteCatalogLoaded().then(() => mounted && force((n) => n + 1));
    }
    const fn = () => mounted && force((n) => n + 1);
    subs.add(fn);
    return () => {
      mounted = false;
      subs.delete(fn);
    };
  }, []);
  const all = _cache ? mergeCatalog(_cache) : SPRITES;
  if (!workspaceId) return all.filter((s) => !dynamicWorkspaceOf(s));
  return all.filter((s) => {
    const ws = dynamicWorkspaceOf(s);
    return !ws || ws === workspaceId;
  });
}

// helper: precisa do workspace_id da row original; armazenamos em _meta opcional
const wsByDynamicId = new Map<string, string | null>();
function dynamicWorkspaceOf(s: SpriteDef): string | null {
  return wsByDynamicId.get(s.id) ?? null;
}

// Atualiza o mapeamento ws -> skin ao carregar
const _origLoad = loadDb;
(loadDb as any) = async function (): Promise<SpriteDef[]> {
  const { data } = await supabase.from("sprite_skins" as any).select("*");
  (data ?? []).forEach((d: any) => wsByDynamicId.set(d.id, d.workspace_id ?? null));
  return (data ?? []).map((s: any) => toSpriteDef(s));
};

export function invalidateSpriteCatalog() {
  _cache = null;
  wsByDynamicId.clear();
}
