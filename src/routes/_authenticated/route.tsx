import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  const navigate = useNavigate();
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const timeout = window.setTimeout(async () => {
      if (cancelled || allowed) return;
      await supabase.auth.signOut({ scope: "local" });
      navigate({ to: "/auth", replace: true });
    }, 6000);

    (async () => {
      const { data, error } = await supabase.auth.getUser();
      if (cancelled) return;
      window.clearTimeout(timeout);
      if (error || !data.user) {
        await supabase.auth.signOut({ scope: "local" });
        navigate({ to: "/auth", replace: true });
        return;
      }
      setAllowed(true);
    })();

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [allowed, navigate]);

  if (!allowed) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">
        Verificando acesso…
      </div>
    );
  }

  return <Outlet />;
}
