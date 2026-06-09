// Carrega skins dinâmicas do banco e mescla com o catálogo hard-coded.
// O componente AlignedSprite continua consultando SPRITES via getSprite;
// para incluir skins dinâmicas, importe o catálogo via useSpriteCatalog.

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

let _cache: SpriteDef[] | null = null;
const _wsById = new Map<string, string | null>();
const subs = new Set<() => void>();

async function loadDb(): Promise<SpriteDef[]> {
  const { data, error } = await (supabase as any).from("sprite_skins").select("*");
  if (error || !data) return [];
  const rows = data as unknown as DbSkin[];
  rows.forEach((d) => _wsById.set(d.id, d.workspace_id ?? null));
  return rows.map(toSpriteDef);
}

function merge(dynamic: SpriteDef[]): SpriteDef[] {
  const byId = new Map(SPRITES.map((s) => [s.id, s]));
  dynamic.forEach((s) => byId.set(s.id, s));
  return Array.from(byId.values());
}

export async function ensureSpriteCatalogLoaded(): Promise<SpriteDef[]> {
  if (_cache) return merge(_cache);
  const dynamic = await loadDb();
  _cache = dynamic;
  subs.forEach((fn) => fn());
  return merge(dynamic);
}

export function invalidateSpriteCatalog() {
  _cache = null;
  _wsById.clear();
}

/**
 * Devolve as skins disponíveis (hard-coded + dinâmicas).
 * Se workspaceId for passado, filtra: skins globais + skins desse ws.
 * Se for null/undefined, devolve só skins globais (hard-coded + dinâmicas sem ws).
 */
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
  const all = _cache ? merge(_cache) : SPRITES;
  return all.filter((s) => {
    const ws = _wsById.get(s.id) ?? null;
    if (!ws) return true;
    return ws === workspaceId;
  });
}
