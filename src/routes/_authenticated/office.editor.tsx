import { createFileRoute } from "@tanstack/react-router";
import { MapEditor } from "@/components/office/MapEditor";

export const Route = createFileRoute("/_authenticated/office/editor")({
  head: () => ({
    meta: [{ title: "Editor de Mapa — Prestativa Office" }],
  }),
  component: () => <MapEditor />,
});
