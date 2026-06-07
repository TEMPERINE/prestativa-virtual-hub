import { createFileRoute, redirect } from "@tanstack/react-router";

// Legacy: sempre manda o usuário para o hub de seleção de workspaces.
// Quem tem mais de um precisa escolher onde estar online — só é possível
// estar presente em um escritório por vez.
export const Route = createFileRoute("/_authenticated/office")({
  beforeLoad: () => {
    throw redirect({ to: "/workspaces" });
  },
  component: () => null,
});
