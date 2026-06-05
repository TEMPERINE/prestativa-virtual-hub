import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { OfficeScene } from "@/components/office/OfficeScene";
import { PreloadScreen } from "@/components/office/PreloadScreen";

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
  const [ready, setReady] = useState(false);
  return (
    <>
      {/* OfficeScene monta em paralelo, mas o preloader cobre a tela até tudo
          estar pronto pra evitar flash de mapa em branco/baixa qualidade. */}
      <div style={{ visibility: ready ? "visible" : "hidden" }}>
        <OfficeScene />
      </div>
      {!ready && <PreloadScreen onReady={() => setReady(true)} />}
    </>
  );
}
