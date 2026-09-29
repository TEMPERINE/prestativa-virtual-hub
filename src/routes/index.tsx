import { createFileRoute, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Início — Prestativa Office" },
      { name: "description", content: "Acesse seu escritório virtual Prestativa Office." },
      { property: "og:title", content: "Início — Prestativa Office" },
      { property: "og:description", content: "Acesse seu escritório virtual Prestativa Office." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error) await supabase.auth.signOut({ scope: "local" });
    if (data.user && !error) throw redirect({ to: "/workspaces" });
    throw redirect({ to: "/auth" });
  },
  component: () => null,
});
