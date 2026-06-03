import { createFileRoute } from "@tanstack/react-router";
import { OfficeScene } from "@/components/office/OfficeScene";

export const Route = createFileRoute("/_authenticated/office")({
  head: () => ({
    meta: [
      { title: "Escritório — Prestativa Office" },
      { name: "description", content: "Trabalhe junto com a equipe da Prestativa em tempo real." },
    ],
  }),
  component: OfficePage,
});

function OfficePage() {
  return <OfficeScene />;
}
