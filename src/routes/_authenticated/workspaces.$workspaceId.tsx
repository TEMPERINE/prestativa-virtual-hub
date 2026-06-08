import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { OfficeScene } from "@/components/office/OfficeScene";
import { PreloadScreen } from "@/components/office/PreloadScreen";
import { supabase } from "@/integrations/supabase/client";
import { setCurrentWorkspaceId } from "@/lib/workspace/current";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/workspaces/$workspaceId")({
  head: () => ({
    meta: [
      { title: "Espaço — Prestativa Office" },
      { name: "description", content: "Trabalhe junto com a equipe da Prestativa em tempo real." },
    ],
  }),
  component: WorkspaceScenePage,
});

function WorkspaceScenePage() {
  const { workspaceId } = Route.useParams();
  const navigate = useNavigate();
  const [authorized, setAuthorized] = useState<null | boolean>(null);
  const [sceneHydrated, setSceneHydrated] = useState(false);
  const [ready, setReady] = useState(false);
  const hydratedRef = useRef(false);

  // Set workspace ID synchronously on mount, before scene mounts.
  // Done in render (idempotent) so first OfficeScene effects see it.
  if (authorized === null) {
    setCurrentWorkspaceId(workspaceId);
  }

  useEffect(() => {
    let cancel = false;
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) { navigate({ to: "/auth" }); return; }

      // Onboarding gate.
      const { data: prof } = await supabase
        .from("profiles")
        .select("onboarded_at")
        .eq("id", u.user.id)
        .maybeSingle();
      if (!prof?.onboarded_at) { navigate({ to: "/onboarding" }); return; }

      // Membership check (RLS-friendly).
      const { data: mem } = await supabase
        .from("workspace_members")
        .select("role")
        .eq("workspace_id", workspaceId)
        .eq("user_id", u.user.id)
        .maybeSingle();

      if (cancel) return;
      if (!mem) {
        toast.error("Você não tem acesso a este espaço.");
        navigate({ to: "/workspaces" });
        return;
      }
      try { localStorage.setItem("lastWorkspaceId", workspaceId); } catch {}
      setCurrentWorkspaceId(workspaceId);
      setAuthorized(true);
    })();
    return () => { cancel = true; };
  }, [workspaceId, navigate]);

  useEffect(() => () => { setCurrentWorkspaceId(null); }, []);

  const handleHydrated = useCallback(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    setSceneHydrated(true);
  }, []);

  useEffect(() => {
    if (sceneHydrated) return;
    const id = window.setTimeout(() => setSceneHydrated(true), 8000);
    return () => window.clearTimeout(id);
  }, [sceneHydrated]);

  if (authorized !== true) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">
        Carregando espaço…
      </div>
    );
  }

  return (
    <>
      <div style={{ visibility: ready ? "visible" : "hidden" }}>
        <OfficeScene onHydrated={handleHydrated} />
      </div>
      {!ready && (
        <PreloadScreen
          canFinish={sceneHydrated}
          onReady={() => setReady(true)}
        />
      )}
    </>
  );
}
