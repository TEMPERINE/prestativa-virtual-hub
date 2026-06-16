// Server functions de gestão de contas — somente super-admin (role 'admin').
//
// Centraliza:
//  - createAccount: cria usuário no auth + define plano + (opcional) adiciona a um espaço
//  - listAccounts: lista todos os perfis com plano, role, contagem de espaços
//  - setAccountPlan: troca o plano de uma conta
//  - resetAccountPassword: redefine senha
//  - deleteAccount: remove conta completamente

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Plan = "essencial" | "pro" | "premium";

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

export const adminListAccounts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await ensureAdmin(context as any);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: users, error: usersErr } =
      await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 200 });
    if (usersErr) throw new Error(usersErr.message);

    const ids = users.users.map((u) => u.id);
    const [{ data: profiles }, { data: roles }, { data: members }] = await Promise.all([
      supabaseAdmin.from("profiles").select("id, display_name, plan, group_id").in("id", ids),
      supabaseAdmin.from("user_roles").select("user_id, role").in("user_id", ids),
      supabaseAdmin
        .from("workspace_members")
        .select("user_id, workspace_id, role, workspaces:workspace_id(name)")
        .in("user_id", ids),
    ]);

    const byId = new Map(
      users.users.map((u) => ({
        id: u.id,
        email: u.email ?? "",
        created_at: u.created_at,
        last_sign_in_at: u.last_sign_in_at ?? null,
      })).map((u) => [u.id, u as any]),
    );
    (profiles ?? []).forEach((p: any) => {
      const row = byId.get(p.id);
      if (row) {
        row.display_name = p.display_name;
        row.plan = (p.plan ?? "essencial") as Plan;
        row.group_id = p.group_id ?? null;
      }
    });
    (roles ?? []).forEach((r: any) => {
      const row = byId.get(r.user_id);
      if (row) row.roles = [...(row.roles ?? []), r.role];
    });
    (members ?? []).forEach((m: any) => {
      const row = byId.get(m.user_id);
      if (row) row.workspaces = [...(row.workspaces ?? []), { id: m.workspace_id, name: m.workspaces?.name, role: m.role }];
    });

    return { accounts: Array.from(byId.values()) };
  });

export const adminCreateAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: {
    email: string;
    password: string;
    displayName: string;
    plan: Plan;
    workspaceId?: string | null;
    workspaceRole?: "owner" | "admin" | "member";
  }) => {
    if (!input.email || !/^\S+@\S+\.\S+$/.test(input.email)) throw new Error("Email inválido");
    if (!input.password || input.password.length < 6) throw new Error("Senha precisa ter ao menos 6 caracteres");
    if (!["essencial", "pro", "premium"].includes(input.plan)) throw new Error("Plano inválido");
    return input;
  })
  .handler(async ({ context, data }) => {
    await ensureAdmin(context as any);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
      user_metadata: { display_name: data.displayName || data.email.split("@")[0] },
    });
    if (error || !created.user) throw new Error(error?.message ?? "Falha ao criar conta");

    const newId = created.user.id;

    // Trigger handle_new_user já criou profile + role 'member'.
    // Atualiza o display_name (caso difira) e o plano.
    await supabaseAdmin
      .from("profiles")
      .update({ display_name: data.displayName || data.email.split("@")[0], plan: data.plan })
      .eq("id", newId);

    if (data.workspaceId) {
      await supabaseAdmin
        .from("workspace_members")
        .upsert(
          { workspace_id: data.workspaceId, user_id: newId, role: data.workspaceRole ?? "member" },
          { onConflict: "workspace_id,user_id" },
        );
    }

    return { id: newId, email: data.email };
  });

export const adminSetAccountPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { userId: string; plan: Plan }) => {
    if (!["essencial", "pro", "premium"].includes(input.plan)) throw new Error("Plano inválido");
    return input;
  })
  .handler(async ({ context, data }) => {
    await ensureAdmin(context as any);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("profiles").update({ plan: data.plan }).eq("id", data.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const adminResetPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { userId: string; password: string }) => {
    if (!input.password || input.password.length < 6) throw new Error("Senha precisa ter ao menos 6 caracteres");
    return input;
  })
  .handler(async ({ context, data }) => {
    await ensureAdmin(context as any);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.userId, { password: data.password });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const adminAssignToWorkspace = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: {
    userId: string;
    workspaceId: string;
    role?: "owner" | "admin" | "member";
  }) => input)
  .handler(async ({ context, data }) => {
    await ensureAdmin(context as any);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("workspace_members")
      .upsert(
        { workspace_id: data.workspaceId, user_id: data.userId, role: data.role ?? "member" },
        { onConflict: "workspace_id,user_id" },
      );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const adminRemoveFromWorkspace = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { userId: string; workspaceId: string }) => input)
  .handler(async ({ context, data }) => {
    await ensureAdmin(context as any);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("workspace_members")
      .delete()
      .eq("user_id", data.userId)
      .eq("workspace_id", data.workspaceId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const adminDeleteAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { userId: string }) => input)
  .handler(async ({ context, data }) => {
    await ensureAdmin(context as any);
    if (data.userId === (context as any).userId) throw new Error("Você não pode excluir sua própria conta");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.deleteUser(data.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const adminListWorkspaces = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await ensureAdmin(context as any);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("workspaces")
      .select("id, name, tier")
      .order("name");
    if (error) throw new Error(error.message);
    return { workspaces: data ?? [] };
  });
