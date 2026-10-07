import { createFileRoute } from "@tanstack/react-router";
import { MeetingsPanel } from "@/components/meetings/MeetingsPanel";

// Rota isolada (acesso direto). Dentro do Office o mesmo painel abre via ?panel=meetings.
export const Route = createFileRoute("/_authenticated/meetings")({
  head: () => ({
    meta: [
      { title: "Minhas Reuniões — Prestativa Office" },
      { name: "description", content: "Histórico das suas reuniões no espaço virtual." },
      { property: "og:title", content: "Minhas Reuniões — Prestativa Office" },
      { property: "og:description", content: "Histórico das suas reuniões no espaço virtual." },
    ],
  }),
  component: () => <MeetingsPanel />,
});
