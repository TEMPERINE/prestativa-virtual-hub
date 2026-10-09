import { AlignedSprite } from "@/components/sprites/AlignedSprite";
import { getSprite } from "@/lib/sprite-catalog";

/** Portrait crop only; atlas selection and head alignment remain in AlignedSprite. */
export function SpriteAvatar({ spriteId, size = 36, offline = false }: {
  spriteId: string | null | undefined;
  size?: number;
  offline?: boolean;
}) {
  const sprite = getSprite(spriteId);
  const portraitHeight = size * 2.2;
  const renderSize = portraitHeight * 300 / sprite.dims.down.h;
  return (
    <div
      aria-hidden="true"
      data-sprite-portrait
      data-offline={offline}
      className={`sprite-portrait relative shrink-0 overflow-hidden rounded-full bg-accent ${offline ? "grayscale opacity-40" : ""}`}
      style={{ width: size, height: size }}
    >
      <AlignedSprite
        spriteId={spriteId}
        facing="down"
        size={renderSize}
        mode="preview"
        style={{ width: size, height: portraitHeight, position: "absolute", top: size * 0.06, overflow: "visible" }}
      />
    </div>
  );
}