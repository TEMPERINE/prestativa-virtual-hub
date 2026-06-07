import { createFileRoute, redirect } from "@tanstack/react-router";

// Legacy route: now redirects to the workspace hub (or the last-used
// workspace, when available) so existing links keep working.
export const Route = createFileRoute("/_authenticated/office")({
  beforeLoad: () => {
    if (typeof window !== "undefined") {
      const last = window.localStorage.getItem("lastWorkspaceId");
      if (last) {
        throw redirect({ to: "/workspaces/$workspaceId", params: { workspaceId: last } });
      }
    }
    throw redirect({ to: "/workspaces" });
  },
  component: () => null,
});
