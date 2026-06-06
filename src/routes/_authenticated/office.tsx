import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
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
  // Dois gates: assets carregados + posição real do personagem resolvida.
  // Só quando AMBOS estão prontos o preloader some — assim o usuário nunca
  // vê o avatar "pulando" do spawn pro último ponto salvo.
  const [assetsReady, setAssetsReady] = useState(false);
  const [sceneHydrated, setSceneHydrated] = useState(false);
  const [ready, setReady] = useState(false);
  const hydratedRef = useRef(false);

  const handleHydrated = useCallback(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    setSceneHydrated(true);
  }, []);

  useEffect(() => {
    if (assetsReady && sceneHydrated) {
      // pequeno delay garante que o primeiro frame do office já pintou
      const id = window.setTimeout(() => setReady(true), 120);
      return () => window.clearTimeout(id);
    }
  }, [assetsReady, sceneHydrated]);

  // Fallback: se algo travar a hidratação, libera depois de 8s pra não
  // prender o usuário na tela de loading pra sempre.
  useEffect(() => {
    if (sceneHydrated) return;
    const id = window.setTimeout(() => setSceneHydrated(true), 8000);
    return () => window.clearTimeout(id);
  }, [sceneHydrated]);

  return (
    <>
      <div style={{ visibility: ready ? "visible" : "hidden" }}>
        <OfficeScene onHydrated={handleHydrated} />
      </div>
      {!ready && <PreloadScreen onReady={() => setAssetsReady(true)} />}
    </>
  );
}
