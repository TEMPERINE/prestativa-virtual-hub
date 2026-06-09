// Helpers de convite de espaço (somente member invites — signup público foi removido).

import { supabase } from "@/integrations/supabase/client";

export type InvitePeek = {
  kind: "member" | null;
  valid: boolean;
  expires_at?: string;
  email_lock?: string | null;
  workspace_name?: string | null;
  role?: string | null;
};

/**
 * Base pública pra montar links de convite. O preview do Lovable exige login
 * na Lovable pra abrir, então quem recebe o link não consegue acessar.
 * Trocamos pela URL publicada estável.
 */
export function publicAppBaseUrl(): string {
  if (typeof window === "undefined") return "";
  const envUrl = (import.meta.env.VITE_PUBLIC_APP_URL as string | undefined)?.replace(/\/$/, "");
  if (envUrl) return envUrl;
  const { origin } = window.location;
  if (/lovableproject\.com$/i.test(window.location.hostname)) {
    return "https://prestativa-virtual-hub.lovable.app";
  }
  return origin;
}

export async function peekInvite(token: string): Promise<InvitePeek> {
  const { data, error } = await supabase.rpc("invite_peek", { _token: token });
  if (error || !data) return { kind: null, valid: false };
  return data as InvitePeek;
}
