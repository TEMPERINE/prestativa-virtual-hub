// TEMPORÁRIO — comparação atual vs V5 (Fase 2). Remover após decisão de adoção.
// Não altera catálogo persistido: registra cópias "-v5" em memória só quando esta rota carrega.
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AlignedSprite } from "@/components/sprites/AlignedSprite";
import { SPRITES, getSprite, type Facing } from "@/lib/sprite-catalog";
import mDown from "@/assets/sprites/v5/marcio-down.png";
import mUp from "@/assets/sprites/v5/marcio-up.png";
import mLeft from "@/assets/sprites/v5/marcio-left.png";
import mRight from "@/assets/sprites/v5/marcio-right.png";
import kDown from "@/assets/sprites/v5/karen-down.png";
import kUp from "@/assets/sprites/v5/karen-up.png";
import kLeft from "@/assets/sprites/v5/karen-left.png";
import kRight from "@/assets/sprites/v5/karen-right.png";
import bDown from "@/assets/sprites/v5/bia-down.png";
import bUp from "@/assets/sprites/v5/bia-up.png";
import bLeft from "@/assets/sprites/v5/bia-left.png";

const V5: Record<string, Record<Facing, string>> = {
  marcio: { down: mDown, up: mUp, left: mLeft, right: mRight },
  karen: { down: kDown, up: kUp, left: kLeft, right: kRight },
  bia: { down: bDown, up: bUp, left: bLeft, right: bLeft },
};
for (const id of Object.keys(V5)) {
  if (!SPRITES.some((s) => s.id === `${id}-v5`)) {
    const base = getSprite(id);
    SPRITES.push({ ...base, id: `${id}-v5`, label: `${base.label} V5`, sheets: V5[id] });
  }
}

export const Route = createFileRoute("/sprite-compare")({
  head: () => ({
    meta: [
      { title: "Comparação temporária de sprites V5" },
      { name: "description", content: "Harness interno temporário atual vs V5." },
      { name: "robots", content: "noindex" },
      { property: "og:title", content: "Comparação temporária de sprites V5" },
      { property: "og:description", content: "Harness interno temporário atual vs V5." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Compare,
});

type W = Window & { __pos?: { x: number; y: number; facing: Facing; frame: number } };

function Compare() {
  const [p, setP] = useState({ x: 0, y: 0, facing: "down" as Facing, frame: 0 });
  const [q, setQ] = useState({ zoom: 1, floor: "light", chars: "marcio,karen,bia" });
  useEffect(() => {
    const s = new URLSearchParams(location.search);
    setQ({ zoom: Number(s.get("zoom") ?? 1), floor: s.get("floor") ?? "light", chars: s.get("chars") ?? "marcio,karen,bia" });
    const w = window as W;
    Object.defineProperty(w, "__pos", { configurable: true, set: (v) => setP({ ...v }), get: () => p });
  }, []);
  const bg = q.floor === "light" ? "#e9e2d4" : "#2b2a33";
  const chars = q.chars.split(",");
  return (
    <div style={{ background: bg, width: 1280, height: 1800, overflow: "hidden" }}>
      <div style={{ transform: `scale(${q.zoom})`, transformOrigin: "0 0" }}>
        {chars.map((c, r) =>
          ["", "-v5"].map((suf, col) => (
            <div key={c + suf} data-cell={`${c}${suf}`}
              style={{ position: "absolute", left: 20 + col * 300, top: 20 + r * 200, width: 280, height: 180 }}>
              <div style={{ position: "absolute", left: 40 + p.x, top: 30 + p.y }}>
                <AlignedSprite spriteId={`${c}${suf}`} facing={p.facing} frame={p.frame} mode="scene" />
              </div>
            </div>
          )),
        )}
      </div>
    </div>
  );
}
