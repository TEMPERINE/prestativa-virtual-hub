import { createFileRoute, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error) await supabase.auth.signOut({ scope: "local" });
    if (data.user && !error) throw redirect({ to: "/workspaces" });
    throw redirect({ to: "/auth" });
  },
  component: () => null,
});
