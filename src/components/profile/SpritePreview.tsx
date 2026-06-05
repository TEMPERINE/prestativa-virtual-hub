import { useEffect, useState } from "react";
import { getSprite, SPRITE_FRAMES, type Facing } from "@/lib/sprite-catalog";
import { ensureFrameOffsets, getFrameOffsets, subscribeFrameOffsets } from "@/lib/sprite-alignment";

type Props = {
  spriteId: string | null | undefined;
  facing?: Facing;
  size?: number;
  animate?: boolean;
};

/**
 * Preview estático/animado de um sprite — usado nos grids de seleção
 * de personagem. Aplica o MESMO alinhamento per-frame de cabeça do
 * OfficeScene (via ensureFrameOffsets), com sombra de referência no
 * chão, pra que nenhum sprite "dance" entre frames.
 */
export function SpritePreview({ spriteId, facing = "down", size = 96, animate = false }: Props) {
  const sprite = getSprite(spriteId);
  const useMirror = facing === "left" && sprite.mirrorLeftFromRight;
  const srcFacing: Facing = useMirror ? "right" : facing;
  const dim = sprite.dims[srcFacing];
  const sheet = sprite.sheets[srcFacing];

  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (!animate) return;
    const id = window.setInterval(() => {
      setFrame((f) => (f + 1) % SPRITE_FRAMES);
    }, 140);
    return () => window.clearInterval(id);
  }, [animate]);

  // Carrega offsets per-frame (head alignment) — mesma regra do OfficeScene.
  const [, bumpAlignment] = useState(0);
  useEffect(() => {
    void ensureFrameOffsets(sheet);
    const off = subscribeFrameOffsets(() => bumpAlignment((v) => v + 1));
    return off;
  }, [sheet]);

  // Altura de referência comum a todos os sprites — garante que personagens
  // diferentes tenham a MESMA escala dentro do mesmo container.
  const REF_H = 255;
  const scale = size / REF_H;
  const w = dim.w * scale;
  const h = dim.h * scale;

  const offsets = getFrameOffsets(sheet);
  const off = offsets ? offsets[frame] ?? { dx: 0, dy: 0 } : { dx: 0, dy: 0 };
  const dyPct = -off.dy * 100;
  const bgPosX = ((frame + off.dx) / (SPRITE_FRAMES - 1)) * 100;

  return (
    <div
      style={{
        width: size,
        height: size,
        position: "relative",
        imageRendering: "pixelated",
      }}
    >
      {/* Contact shadow — referência de posição no chão (igual ao OfficeScene) */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          left: "50%",
          bottom: "4%",
          width: "52%",
          height: "8%",
          transform: "translateX(-50%)",
          background:
            "radial-gradient(ellipse at center, rgba(0,0,0,0.40) 0%, rgba(0,0,0,0.24) 45%, rgba(0,0,0,0) 72%)",
          filter: "blur(1.5px)",
          pointerEvents: "none",
          zIndex: 0,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: "50%",
          bottom: 0,
          width: w,
          height: h,
          transform: `translate(-50%, ${dyPct}%) ${useMirror ? "scaleX(-1)" : ""}`,
          backgroundImage: `url(${sheet})`,
          backgroundRepeat: "no-repeat",
          backgroundSize: `${SPRITE_FRAMES * 100}% 100%`,
          backgroundPosition: `${bgPosX}% 100%`,
          imageRendering: "auto",
          zIndex: 1,
        }}
      />
    </div>
  );
}
