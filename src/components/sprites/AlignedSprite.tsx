import { useEffect, useState, type CSSProperties } from "react";
import { getSprite, SPRITE_FRAMES as FRAMES, type Facing } from "@/lib/sprite-catalog";
import { ensureFrameOffsets, getFrameOffsets, subscribeFrameOffsets } from "@/lib/sprite-alignment";

/**
 * Componente UNIFICADO de renderização de sprite de avatar.
 *
 * REGRA OBRIGATÓRIA — toda skin nova deve ser renderizada por este componente.
 * Ele aplica automaticamente:
 *   1. Alinhamento per-frame da cabeça (ensureFrameOffsets) — evita "samba"
 *      horizontal e bob vertical entre frames.
 *   2. Sombra de referência no chão — âncora visual; a cabeça permanece
 *      travada no centro da sombra independente do frame.
 *   3. Espelhamento — skins novas usam só a sheet "left" e renderizam
 *      "right" espelhada, sem inverter o sinal do dx.
 *   4. Escala consistente entre skins via altura/largura de referência.
 *
 * Para adicionar nova skin: basta registrar em `sprite-catalog.ts`.
 * NÃO criar lógica de alinhamento manual fora deste componente.
 */

type Mode = "scene" | "preview";

type Props = {
  spriteId: string | null | undefined;
  facing: Facing;
  /** Frame atual (0..FRAMES-1). Para preview animado, controle externamente ou use `animate`. */
  frame?: number;
  /** Se true e `frame` não for fornecido, anima internamente. */
  animate?: boolean;
  /** Intervalo de animação em ms (default 140). */
  animationMs?: number;
  /**
   * scene: pré-monta todas as direções (visibility hidden) — usado no
   *        OfficeScene onde o personagem troca de direção em tempo real.
   * preview: monta só a direção atual — usado em grids de seleção.
   */
  mode?: Mode;
  /** Largura/altura do container (preview). Ignorado em scene (usa CSS responsivo). */
  size?: number;
  /** Override de estilo do wrapper (use com cuidado). */
  className?: string;
  style?: CSSProperties;
  /** Drop shadow (filter) no sprite — default true em scene, false em preview. */
  dropShadow?: boolean;
};

const SHADOW_STYLES: Record<Mode, CSSProperties> = {
  scene: {
    position: "absolute",
    left: "50%",
    bottom: "-2%",
    width: "62%",
    height: "10%",
    transform: "translateX(-50%)",
    background:
      "radial-gradient(ellipse at center, rgba(0,0,0,0.45) 0%, rgba(0,0,0,0.28) 45%, rgba(0,0,0,0) 72%)",
    filter: "blur(1.5px)",
    pointerEvents: "none",
    zIndex: 0,
  },
  preview: {
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
  },
};

function shouldMirrorFacing(
  facing: Facing,
  mirrorLeftFromRight?: boolean,
  mirrorRightFromLeft?: boolean,
) {
  return (facing === "left" && mirrorLeftFromRight) || (facing === "right" && mirrorRightFromLeft);
}

function getSourceFacing(
  facing: Facing,
  mirrorLeftFromRight?: boolean,
  mirrorRightFromLeft?: boolean,
): Facing {
  if (facing === "left" && mirrorLeftFromRight) return "right";
  if (facing === "right" && mirrorRightFromLeft) return "left";
  return facing;
}

export function AlignedSprite({
  spriteId,
  facing,
  frame: frameProp,
  animate = false,
  animationMs = 140,
  mode = "preview",
  size = 96,
  className,
  style,
  dropShadow,
}: Props) {
  const sprite = getSprite(spriteId);
  const facings: Facing[] = ["down", "up", "left", "right"];

  // Animação interna opcional (quando frame não controlado externamente).
  const [internalFrame, setInternalFrame] = useState(0);
  useEffect(() => {
    if (frameProp !== undefined || !animate) return;
    const id = window.setInterval(
      () => setInternalFrame((f) => (f + 1) % FRAMES),
      animationMs,
    );
    return () => window.clearInterval(id);
  }, [frameProp, animate, animationMs]);
  const rawFrame = frameProp ?? internalFrame;
  // Laterais: troca frame 3 pelo idle pra suavizar caminhada.
  const displayFrame =
    (facing === "left" || facing === "right") && rawFrame === 3 ? 0 : rawFrame;

  // Pré-carrega offsets de todas as sheets relevantes.
  const [, bumpAlignment] = useState(0);
  useEffect(() => {
    const sheetsToLoad =
      mode === "scene"
        ? facings.map((f) => {
            const srcFacing = getSourceFacing(f, sprite.mirrorLeftFromRight, sprite.mirrorRightFromLeft);
            return sprite.sheets[srcFacing];
          })
        : [
            sprite.sheets[
              getSourceFacing(facing, sprite.mirrorLeftFromRight, sprite.mirrorRightFromLeft)
            ],
          ];
    sheetsToLoad.forEach((s) => void ensureFrameOffsets(s));
    const off = subscribeFrameOffsets(() => bumpAlignment((v) => v + 1));
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sprite.id, mode, facing]);

  // Dimensões de referência consistentes entre skins.
  const refH = Math.max(...facings.map((f) => sprite.dims[f].h));
  const refW = Math.max(...facings.map((f) => sprite.dims[f].w));

  const wrapperStyle: CSSProperties =
    mode === "scene"
      ? {
          position: "relative",
          height: "min(9vh, 94px)",
          aspectRatio: `${refW} / ${refH}`,
          ...style,
        }
      : {
          width: size,
          height: size,
          position: "relative",
          imageRendering: "pixelated",
          ...style,
        };

  const showDropShadow = dropShadow ?? mode === "scene";
  const layers = mode === "scene" ? facings : [facing];

  return (
    <div className={className} style={wrapperStyle}>
      <div aria-hidden style={SHADOW_STYLES[mode]} />
      {layers.map((f) => {
        const useMirror = shouldMirrorFacing(f, sprite.mirrorLeftFromRight, sprite.mirrorRightFromLeft);
        const srcFacing = getSourceFacing(f, sprite.mirrorLeftFromRight, sprite.mirrorRightFromLeft);
        const sheet = sprite.sheets[srcFacing];
        const dim = sprite.dims[srcFacing];
        const offsets = getFrameOffsets(sheet);
        const off =
          offsets?.[displayFrame] ?? { dx: 0, dy: 0 };
        const bgPosX = ((displayFrame + off.dx) / (FRAMES - 1)) * 100;
        const dyPct = -off.dy * 100;
        const active = f === facing;

        const layerStyle: CSSProperties =
          mode === "scene"
            ? {
                position: "absolute",
                left: "50%",
                bottom: 0,
                transform: `translate(-50%, ${dyPct}%) ${useMirror ? "scaleX(-1)" : ""}`,
                height: `${(dim.h / refH) * 100}%`,
                width: `${(dim.w / refW) * 100}%`,
                backgroundImage: `url(${sheet})`,
                backgroundRepeat: "no-repeat",
                backgroundSize: `${FRAMES * 100}% 100%`,
                backgroundPosition: `${bgPosX}% 100%`,
                imageRendering: "auto",
                visibility: active ? "visible" : "hidden",
                filter: showDropShadow ? "drop-shadow(0 2px 1px rgba(0,0,0,0.25))" : undefined,
                zIndex: 1,
              }
            : {
                position: "absolute",
                left: "50%",
                bottom: 0,
                width: dim.w * (size / refH),
                height: dim.h * (size / refH),
                transform: `translate(-50%, ${dyPct}%) ${useMirror ? "scaleX(-1)" : ""}`,
                backgroundImage: `url(${sheet})`,
                backgroundRepeat: "no-repeat",
                backgroundSize: `${FRAMES * 100}% 100%`,
                backgroundPosition: `${bgPosX}% 100%`,
                imageRendering: "auto",
                filter: showDropShadow ? "drop-shadow(0 2px 1px rgba(0,0,0,0.25))" : undefined,
                zIndex: 1,
              };
        return <div key={f} style={layerStyle} />;
      })}
    </div>
  );
}
