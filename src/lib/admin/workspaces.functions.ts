// Admin-only server fns para gerenciar espaços (workspaces) fora do hub regular.
// Permite criar, renomear, mudar tier, excluir e listar com metadados.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function ensureAdmin(ctx: { supabase: any; userId: string }) {
  const { data, error } = await ctx.supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", ctx.userId)
    .eq("role", "admin")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("forbidden");
}

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)+/g, "")
      .slice(0, 48) || "espaco"
  );
}

export const adminListWorkspacesFull = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await ensureAdmin(context as any);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: ws, error } = await supabaseAdmin
      .from("workspaces")
      .select("id, name, slug, description, owner_id, tier, created_at")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);

    const ids = (ws ?? []).map((w) => w.id);
    const ownerIds = (ws ?? []).map((w) => w.owner_id).filter(Boolean);

    const [{ data: members }, { data: profiles }] = await Promise.all([
      supabaseAdmin.from("workspace_members").select("workspace_id, user_id").in("workspace_id", ids),
      supabaseAdmin.from("profiles").select("id, display_name").in("id", ownerIds),
    ]);

    const profilesById = new Map((profiles ?? []).map((p: any) => [p.id, p.display_name]));
    const countByWs = new Map<string, number>();
    (members ?? []).forEach((m: any) => countByWs.set(m.workspace_id, (countByWs.get(m.workspace_id) ?? 0) + 1));

    return {
      workspaces: (ws ?? []).map((w: any) => ({
        ...w,
        owner_name: profilesById.get(w.owner_id) ?? "—",
        member_count: countByWs.get(w.id) ?? 0,
      })),
    };
  });

export const adminCreateWorkspace = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { name: string; tier: 1 | 2 | 3; ownerId?: string | null }) => {
    if (!input.name || input.name.trim().length < 2) throw new Error("Nome muito curto");
    if (![1, 2, 3].includes(input.tier)) throw new Error("Tier inválido");
    return input;
  })
  .handler(async ({ context, data }) => {
    await ensureAdmin(context as any);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const ownerId = data.ownerId ?? (context as any).userId;
    const slug = `${slugify(data.name)}-${Math.random().toString(36).slice(2, 6)}`;

    const { data: ws, error } = await supabaseAdmin
      .from("workspaces")
      .insert({ name: data.name.trim(), slug, owner_id: ownerId, tier: data.tier } as any)
      .select("id")
      .single();
    if (error || !ws) throw new Error(error?.message ?? "Falha ao criar");

    await supabaseAdmin
      .from("workspace_members")
      .upsert({ workspace_id: ws.id, user_id: ownerId, role: "owner" }, { onConflict: "workspace_id,user_id" });

    return { id: ws.id };
  });

export const adminUpdateWorkspace = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; name?: string; tier?: 1 | 2 | 3; ownerId?: string }) => input)
  .handler(async ({ context, data }) => {
    await ensureAdmin(context as any);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const patch: any = {};
    if (data.name !== undefined) patch.name = data.name.trim();
    if (data.tier !== undefined) patch.tier = data.tier;
    if (data.ownerId !== undefined) patch.owner_id = data.ownerId;
    const { error } = await supabaseAdmin.from("workspaces").update(patch).eq("id", data.id);
    if (error) throw new Error(error.message);
    if (data.ownerId) {
      await supabaseAdmin
        .from("workspace_members")
        .upsert({ workspace_id: data.id, user_id: data.ownerId, role: "owner" }, { onConflict: "workspace_id,user_id" });
    }
    return { ok: true };
  });

export const adminDeleteWorkspace = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ context, data }) => {
    await ensureAdmin(context as any);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("workspaces").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
