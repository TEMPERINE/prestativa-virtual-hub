import { AlignedSprite } from "@/components/sprites/AlignedSprite";
import type { Facing } from "@/lib/sprite-catalog";

type Props = {
  spriteId: string | null | undefined;
  facing?: Facing;
  size?: number;
  animate?: boolean;
};

/**
 * Preview de sprite usado nos grids de seleção de personagem.
 * Delega para AlignedSprite — TODA a regra de alinhamento + sombra está lá.
 * Não adicionar lógica de renderização de sprite aqui.
 */
export function SpritePreview({ spriteId, facing = "down", size = 96, animate = false }: Props) {
  return (
    <AlignedSprite
      spriteId={spriteId}
      facing={facing}
      size={size}
      animate={animate}
      mode="preview"
    />
  );
}
