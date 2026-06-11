import { useMemo } from "react";
import type { Facing } from "@/lib/sprite-catalog";

type Props = {
  /** Direction the avatar is facing; confetti shoots this way. */
  facing: Facing;
  /** A timestamp/id that, when changed, restarts the burst. */
  burstKey: number;
};

const COLORS = [
  "#ff4d6d",
  "#ffd23f",
  "#3bc9db",
  "#8ce99a",
  "#b197fc",
  "#ffa94d",
  "#74c0fc",
  "#f783ac",
];

// Build a stable set of particles per burst.
function buildParticles(seed: number, facing: Facing) {
  // Base direction vector (screen-space): y- is up.
  const base =
    facing === "up"
      ? { x: 0, y: -1 }
      : facing === "down"
        ? { x: 0, y: 1 }
        : facing === "left"
          ? { x: -1, y: 0 }
          : { x: 1, y: 0 };

  // Cheap deterministic PRNG so each burst is varied but stable across renders.
  let s = seed >>> 0;
  const rand = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };

  const count = 26;
  return Array.from({ length: count }, (_, i) => {
    // Spread within a ~80° cone around the base direction.
    const spread = (rand() - 0.5) * (Math.PI / 2.2);
    const cos = Math.cos(spread);
    const sin = Math.sin(spread);
    const dx = base.x * cos - base.y * sin;
    const dy = base.x * sin + base.y * cos;
    const distance = (36 + rand() * 42) * 1.3; // px (+30% mais longe)
    const tx = dx * distance;
    const ty = dy * distance;
    const size = 4 + Math.floor(rand() * 4);
    const color = COLORS[i % COLORS.length];
    const rot = Math.floor(rand() * 720) - 360;
    const delay = Math.floor(rand() * 60); // ms
    return { tx, ty, size, color, rot, delay, id: i };
  });
}

export function ConfettiBurst({ facing, burstKey }: Props) {
  const particles = useMemo(() => buildParticles(burstKey, facing), [burstKey, facing]);

  return (
    <div
      key={burstKey}
      aria-hidden
      className="pointer-events-none absolute left-1/2 top-1/2 z-20"
      style={{ width: 0, height: 0 }}
    >
      {particles.map((p) => (
        <span
          key={p.id}
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: p.size,
            height: p.size,
            background: p.color,
            borderRadius: 1,
            transform: "translate(-50%, -50%)",
            animation: `confetti-fly 900ms cubic-bezier(0.22, 1, 0.36, 1) ${p.delay}ms both`,
            // CSS custom props consumed by the keyframes
            ["--tx" as never]: `${p.tx}px`,
            ["--ty" as never]: `${p.ty}px`,
            ["--rot" as never]: `${p.rot}deg`,
          }}
        />
      ))}
      <style>{`
        @keyframes confetti-fly {
          0% {
            transform: translate(-50%, -50%) rotate(0deg) scale(0.6);
            opacity: 0;
          }
          15% {
            opacity: 1;
          }
          60% {
            opacity: 1;
          }
          100% {
            transform: translate(calc(-50% + var(--tx)), calc(-50% + var(--ty))) rotate(var(--rot)) scale(1);
            opacity: 0;
          }
        }
      `}</style>
    </div>
  );
}
