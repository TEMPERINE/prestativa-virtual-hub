import { useEffect, useState } from "react";
import officeMap from "@/assets/office-map.webp";
import parkLeft from "@/assets/scene-park-left.webp";
import roadRight from "@/assets/scene-road-right.webp";
import daniWalk from "@/assets/sprites/blonde-right.png";
import doorClosed from "@/assets/props/door-closed.png.asset.json";
import doorOpen from "@/assets/props/door-open.png.asset.json";

// Assets críticos para a primeira render do escritório
const CRITICAL_ASSETS: string[] = [
  officeMap,
  parkLeft,
  roadRight,
  daniWalk,
  doorClosed.url,
  doorOpen.url,
];

const SPRITE_FRAMES = 6;
const FRAME_MS = 110;

function preload(src: string): Promise<void> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve();
    img.onerror = () => resolve(); // não trava se um asset falhar
    img.src = src;
  });
}

type Props = { onReady: () => void };

export function PreloadScreen({ onReady }: Props) {
  const [loaded, setLoaded] = useState(0);
  const [frame, setFrame] = useState(0);
  const [done, setDone] = useState(false);
  const total = CRITICAL_ASSETS.length;
  const pct = Math.round((loaded / total) * 100);

  // Carrega assets em paralelo, contabiliza progresso individual
  useEffect(() => {
    let cancelled = false;
    let count = 0;
    Promise.all(
      CRITICAL_ASSETS.map((src) =>
        preload(src).then(() => {
          if (cancelled) return;
          count += 1;
          setLoaded(count);
        })
      )
    ).then(() => {
      if (cancelled) return;
      // pequena pausa pra mostrar o 100%
      window.setTimeout(() => {
        if (cancelled) return;
        setDone(true);
        window.setTimeout(onReady, 380);
      }, 280);
    });
    return () => { cancelled = true; };
  }, [onReady]);

  // Anima sprite (cycle de frames)
  useEffect(() => {
    const id = window.setInterval(() => {
      setFrame((f) => (f + 1) % SPRITE_FRAMES);
    }, FRAME_MS);
    return () => window.clearInterval(id);
  }, []);

  const SPRITE_SIZE = 64;

  return (
    <div
      className="fixed inset-0 z-[2147483647] flex items-center justify-center transition-opacity duration-300"
      style={{
        background: "linear-gradient(135deg, #1a0b18 0%, #2a1326 50%, #1a0b18 100%)",
        opacity: done ? 0 : 1,
        pointerEvents: done ? "none" : "auto",
      }}
      aria-label="Carregando escritório"
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      {/* Sutil brilho de fundo */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse at center, rgba(236,72,153,0.18) 0%, transparent 60%)",
          animation: "preload-pulse 2.4s ease-in-out infinite",
        }}
      />

      <div className="relative w-[min(80vw,520px)] flex flex-col items-center gap-5">
        <div className="text-center">
          <div
            className="text-2xl font-bold tracking-wide"
            style={{
              color: "#ffd0e5",
              textShadow: "0 0 20px rgba(236,72,153,0.6)",
            }}
          >
            Prestativa Office
          </div>
          <div className="text-xs uppercase tracking-[0.3em] mt-1 text-pink-200/60">
            Preparando seu escritório
          </div>
        </div>

        {/* Trilho da barra com sprite andando em cima */}
        <div className="relative w-full">
          {/* Dani caminhando (frame da sprite-sheet de 6 frames) */}
          <div
            className="absolute -top-[58px]"
            style={{
              left: `calc(${pct}% - ${SPRITE_SIZE / 2}px)`,
              width: SPRITE_SIZE,
              height: SPRITE_SIZE,
              transition: "left 0.35s cubic-bezier(0.22, 1, 0.36, 1)",
              filter: "drop-shadow(0 4px 8px rgba(236,72,153,0.45))",
            }}
          >
            <div
              style={{
                width: SPRITE_SIZE,
                height: SPRITE_SIZE,
                backgroundImage: `url(${daniWalk})`,
                backgroundSize: `${SPRITE_FRAMES * 100}% 100%`,
                backgroundPosition: `${(frame / (SPRITE_FRAMES - 1)) * 100}% 0`,
                backgroundRepeat: "no-repeat",
                imageRendering: "pixelated",
              }}
            />
          </div>

          {/* Barra rosa */}
          <div
            className="relative w-full h-3 rounded-full overflow-hidden"
            style={{
              background: "rgba(255,255,255,0.07)",
              boxShadow:
                "inset 0 1px 2px rgba(0,0,0,0.4), 0 0 0 1px rgba(236,72,153,0.18)",
            }}
          >
            <div
              className="h-full rounded-full relative overflow-hidden"
              style={{
                width: `${pct}%`,
                background:
                  "linear-gradient(90deg, #f472b6 0%, #ec4899 45%, #f9a8d4 100%)",
                boxShadow:
                  "0 0 12px rgba(236,72,153,0.85), 0 0 24px rgba(236,72,153,0.45)",
                transition: "width 0.35s cubic-bezier(0.22, 1, 0.36, 1)",
              }}
            >
              {/* Brilho deslizando */}
              <div
                className="absolute inset-y-0 w-1/3"
                style={{
                  background:
                    "linear-gradient(90deg, transparent, rgba(255,255,255,0.6), transparent)",
                  animation: "preload-shine 1.4s linear infinite",
                }}
              />
            </div>
          </div>
        </div>

        <div className="flex items-baseline gap-2">
          <span
            className="text-3xl font-bold tabular-nums"
            style={{
              color: "#fff",
              textShadow: "0 0 16px rgba(236,72,153,0.65)",
            }}
          >
            {pct}
          </span>
          <span className="text-sm font-semibold text-pink-200/70">%</span>
        </div>

        <div className="text-[11px] text-pink-100/40 -mt-2">
          {loaded} de {total} elementos carregados
        </div>
      </div>

      <style>{`
        @keyframes preload-shine {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(400%); }
        }
        @keyframes preload-pulse {
          0%, 100% { opacity: 0.7; }
          50% { opacity: 1; }
        }
      `}</style>
    </div>
  );
}
