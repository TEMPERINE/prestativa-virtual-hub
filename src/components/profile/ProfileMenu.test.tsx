// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from "@tanstack/react-router";
import { afterEach, expect, it } from "vitest";
import { ProfileMenu } from "./ProfileMenu";

afterEach(cleanup);
const noop = () => {};
// jsdom has no page scrolling; the router uses this browser API on navigation.
window.scrollTo = noop;

it("sair do espaço navega para a seleção de espaços pelo router", async () => {
  const root = createRootRoute({ component: Outlet });
  const office = createRoute({
    getParentRoute: () => root,
    path: "/workspaces/$workspaceId",
    component: () => <ProfileMenu
      me={{ id: "test-user", display_name: "Usuário", avatar_color: "#ff5599" }}
      email="user@example.test" hasClaim={false}
      onEditCharacter={noop} onEditProfile={noop} onGoToMyDesk={noop}
      onRestartOnboarding={noop} onStatusChanged={noop}
      onOpenSavedNotes={noop} onLeaveDesk={noop}
    />,
  });
  const hub = createRoute({ getParentRoute: () => root, path: "/workspaces", component: () => <h1>Seus espaços</h1> });
  const router = createRouter({
    routeTree: root.addChildren([office, hub]),
    history: createMemoryHistory({ initialEntries: ["/workspaces/office-test"] }),
  });
  await router.load();
  render(<RouterProvider router={router} />);
  fireEvent.click(await screen.findByRole("button", { name: "Meu perfil" }));
  fireEvent.click(await screen.findByRole("link", { name: "Sair do espaço" }));
  await waitFor(() => expect(router.state.location.pathname).toBe("/workspaces"));
  expect(await screen.findByRole("heading", { name: "Seus espaços" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Meu perfil" })).toBeNull();
});
