import { useEffect, useState } from "react";
import { getSprite, SPRITE_FRAMES, type Facing } from "@/lib/sprite-catalog";

type Props = {
  spriteId: string | null | undefined;
  facing?: Facing;
  size?: number;
  animate?: boolean;
};

/**
 * Preview estático/animado de um sprite específico — usado nos grids
 * de seleção de personagem. Mostra o frame 0 (idle) por padrão, e
 * cicla pelos frames quando animate=true.
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

  const scale = size / dim.h;
  const w = dim.w * scale;
  const h = size;

  return (
    <div
      style={{
        width: w,
        height: h,
        overflow: "hidden",
        position: "relative",
        imageRendering: "pixelated",
        transform: useMirror ? "scaleX(-1)" : undefined,
      }}
    >
      <img
        src={sheet}
        alt={sprite.label}
        style={{
          height: h,
          width: w * SPRITE_FRAMES,
          maxWidth: "none",
          transform: `translateX(-${frame * w}px)`,
          imageRendering: "pixelated",
          objectFit: "cover",
        }}
        draggable={false}
      />
    </div>
  );
}
