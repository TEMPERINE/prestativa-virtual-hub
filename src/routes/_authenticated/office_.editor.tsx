import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect } from "react";
import { MapEditor } from "@/components/office/MapEditor";
import { setCurrentWorkspaceId, getCurrentWorkspaceId } from "@/lib/workspace/current";

function EditorPage() {
  useEffect(() => {
    if (getCurrentWorkspaceId()) return;
    if (typeof window === "undefined") return;
    const last = window.localStorage.getItem("lastWorkspaceId");
    if (last) setCurrentWorkspaceId(last);
  }, []);
  return <MapEditor />;
}

export const Route = createFileRoute("/_authenticated/office_/editor")({
  head: () => ({
    meta: [{ title: "Editor de Mapa — Prestativa Office" }],
  }),
  beforeLoad: () => {
    if (typeof window === "undefined") return;
    if (getCurrentWorkspaceId()) return;
    const last = window.localStorage.getItem("lastWorkspaceId");
    if (!last) {
      throw redirect({ to: "/workspaces" });
    }
    setCurrentWorkspaceId(last);
  },
  component: EditorPage,
});
