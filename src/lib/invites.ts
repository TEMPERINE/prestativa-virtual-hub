// Helpers de convite: armazena token pendente entre signup → onboarding → redeem.
// Usa sessionStorage pra não vazar entre sessões/abas distintas.

import { supabase } from "@/integrations/supabase/client";

const STORAGE_KEY = "prestativa:pendingInviteToken";

export type InvitePeek = {
  kind: "signup" | "member" | null;
  valid: boolean;
  expires_at?: string;
  email_lock?: string | null;
  plan?: "essencial" | "pro" | "premium";
  tier?: 1 | 2 | 3;
  workspace_name_suggestion?: string | null;
  workspace_name?: string | null;
  role?: string | null;
};

export function setPendingInviteToken(token: string | null) {
  try {
    if (token) sessionStorage.setItem(STORAGE_KEY, token);
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {}
}

export function getPendingInviteToken(): string | null {
  try { return sessionStorage.getItem(STORAGE_KEY); } catch { return null; }
}

export async function peekInvite(token: string): Promise<InvitePeek> {
  const { data, error } = await supabase.rpc("invite_peek", { _token: token });
  if (error || !data) return { kind: null, valid: false };
  return data as InvitePeek;
}

export async function redeemPendingInvite(): Promise<string | null> {
  const token = getPendingInviteToken();
  if (!token) return null;
  const peek = await peekInvite(token);
  if (!peek.valid || !peek.kind) {
    setPendingInviteToken(null);
    return null;
  }
  if (peek.kind === "signup") {
    const { data, error } = await supabase.rpc("signup_invite_redeem", { _token: token });
    setPendingInviteToken(null);
    if (error) throw error;
    return data as string;
  } else {
    const { data, error } = await supabase.rpc("workspace_accept_invite", { _token: token });
    setPendingInviteToken(null);
    if (error) throw error;
    return data as string;
  }
}
