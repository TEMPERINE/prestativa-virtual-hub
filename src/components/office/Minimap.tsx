import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Map as MapIcon } from "lucide-react";
import { ZONES, FLOOR_POLY, type ZoneId, type Point } from "@/lib/office-map";

type Player = { id: string; x: number; y: number; color: string; name: string };

type Props = {
  myId: string | null;
  myPos: Point;
  positions: Record<string, { user_id: string; x: number; y: number; is_online: boolean }>;
  profiles: Record<string, { id: string; display_name: string; avatar_color: string }>;
  onTeleport: (zoneId: ZoneId, label?: string) => void;
};

// Aspect derived from FLOOR_POLY proportions of the office image (~16:9 area).
const MM_W = 220;
const MM_H = 130;

export function Minimap({ myId, myPos, positions, profiles, onTeleport }: Props) {
  const [open, setOpen] = useState(true);

  const players = useMemo<Player[]>(() => {
    const list: Player[] = [];
    for (const p of Object.values(positions)) {
      if (!p.is_online) continue;
      if (p.user_id === myId) continue;
      const prof = profiles[p.user_id];
      list.push({
        id: p.user_id,
        x: p.x,
        y: p.y,
        color: prof?.avatar_color || "#94a3b8",
        name: prof?.display_name || "Alguém",
      });
    }
    return list;
  }, [positions, profiles, myId]);

  const meColor = (myId && profiles[myId]?.avatar_color) || "#10b981";

  // Density per zone (only named rooms, skip lobby/atendente seats for compactness label)
  const density = useMemo(() => {
    const counts: Record<string, number> = {};
    const all = [...players, ...(myId ? [{ id: myId, x: myPos.x, y: myPos.y, color: meColor, name: "Eu" }] : [])];
    for (const pl of all) {
      for (const z of ZONES) {
        if (z.id === "lobby") continue;
        if (pl.x >= z.rect.x1 && pl.x <= z.rect.x2 && pl.y >= z.rect.y1 && pl.y <= z.rect.y2) {
          counts[z.id] = (counts[z.id] ?? 0) + 1;
          break;
        }
      }
    }
    return counts;
  }, [players, myId, myPos, meColor]);

  // Map a 0..1 point to minimap pixel coords using FLOOR_POLY bounds.
  const minX = Math.min(...FLOOR_POLY.map((p) => p.x));
  const minY = Math.min(...FLOOR_POLY.map((p) => p.y));
  const maxX = Math.max(...FLOOR_POLY.map((p) => p.x));
  const maxY = Math.max(...FLOOR_POLY.map((p) => p.y));
  const toPx = (x: number, y: number) => ({
    x: ((x - minX) / (maxX - minX)) * MM_W,
    y: ((y - minY) / (maxY - minY)) * MM_H,
  });

  return (
    <div className="absolute left-3 bottom-3 z-[90] pointer-events-auto select-none">
      <div className="rounded-xl bg-black/65 backdrop-blur-md border border-white/10 shadow-soft overflow-hidden">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="w-full flex items-center justify-between gap-2 px-3 py-1.5 text-xs text-white/90 hover:bg-white/5 transition"
        >
          <span className="flex items-center gap-1.5">
            <MapIcon className="w-3.5 h-3.5" />
            Minimapa
          </span>
          {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
        </button>

        {open && (
          <div className="p-2 pt-1">
            <div
              className="relative rounded-md overflow-hidden border border-white/10"
              style={{ width: MM_W, height: MM_H, background: "rgba(255,255,255,0.04)" }}
            >
              {/* Zone rectangles */}
              <svg width={MM_W} height={MM_H} className="absolute inset-0">
                {ZONES.filter((z) => z.id !== "lobby" && !z.id.startsWith("atendente-")).map((z) => {
                  const tl = toPx(z.rect.x1, z.rect.y1);
                  const br = toPx(z.rect.x2, z.rect.y2);
                  return (
                    <g key={z.id}>
                      <rect
                        x={tl.x}
                        y={tl.y}
                        width={Math.max(2, br.x - tl.x)}
                        height={Math.max(2, br.y - tl.y)}
                        fill={`color-mix(in oklab, ${z.accent} 18%, transparent)`}
                        stroke={`color-mix(in oklab, ${z.accent} 60%, transparent)`}
                        strokeWidth={0.8}
                        className="cursor-pointer hover:fill-white/20 transition"
                        onClick={() => onTeleport(z.id as ZoneId, z.label)}
                      >
                        <title>{`${z.label} — clique para ir`}</title>
                      </rect>
                      {density[z.id] ? (
                        <g pointerEvents="none">
                          <circle
                            cx={tl.x + (br.x - tl.x) / 2}
                            cy={tl.y + (br.y - tl.y) / 2}
                            r={7}
                            fill="rgba(0,0,0,0.55)"
                          />
                          <text
                            x={tl.x + (br.x - tl.x) / 2}
                            y={tl.y + (br.y - tl.y) / 2 + 3}
                            textAnchor="middle"
                            fontSize={9}
                            fill="#fff"
                            fontWeight={600}
                          >
                            {density[z.id]}
                          </text>
                        </g>
                      ) : null}
                    </g>
                  );
                })}

                {/* Atendente desk cluster as a single block */}
                {(() => {
                  const seats = ZONES.filter((z) => z.id.startsWith("atendente-"));
                  if (!seats.length) return null;
                  const x1 = Math.min(...seats.map((s) => s.rect.x1));
                  const y1 = Math.min(...seats.map((s) => s.rect.y1));
                  const x2 = Math.max(...seats.map((s) => s.rect.x2));
                  const y2 = Math.max(...seats.map((s) => s.rect.y2));
                  const tl = toPx(x1, y1);
                  const br = toPx(x2, y2);
                  const count = seats.reduce((acc, s) => acc + (density[s.id] ?? 0), 0);
                  return (
                    <g>
                      <rect
                        x={tl.x}
                        y={tl.y}
                        width={br.x - tl.x}
                        height={br.y - tl.y}
                        fill="color-mix(in oklab, var(--zone-operacao) 18%, transparent)"
                        stroke="color-mix(in oklab, var(--zone-operacao) 60%, transparent)"
                        strokeWidth={0.8}
                      >
                        <title>Atendimento</title>
                      </rect>
                      {count > 0 && (
                        <g pointerEvents="none">
                          <circle
                            cx={tl.x + (br.x - tl.x) / 2}
                            cy={tl.y + (br.y - tl.y) / 2}
                            r={7}
                            fill="rgba(0,0,0,0.55)"
                          />
                          <text
                            x={tl.x + (br.x - tl.x) / 2}
                            y={tl.y + (br.y - tl.y) / 2 + 3}
                            textAnchor="middle"
                            fontSize={9}
                            fill="#fff"
                            fontWeight={600}
                          >
                            {count}
                          </text>
                        </g>
                      )}
                    </g>
                  );
                })()}
              </svg>

              {/* Player dots */}
              {players.map((pl) => {
                const pt = toPx(pl.x, pl.y);
                return (
                  <div
                    key={pl.id}
                    className="absolute rounded-full"
                    style={{
                      left: pt.x - 3,
                      top: pt.y - 3,
                      width: 6,
                      height: 6,
                      background: pl.color,
                      boxShadow: "0 0 0 1px rgba(0,0,0,0.6)",
                    }}
                    title={pl.name}
                  />
                );
              })}

              {/* Me dot (with ring) */}
              {myId && (() => {
                const pt = toPx(myPos.x, myPos.y);
                return (
                  <div
                    className="absolute rounded-full animate-pulse"
                    style={{
                      left: pt.x - 4,
                      top: pt.y - 4,
                      width: 8,
                      height: 8,
                      background: meColor,
                      boxShadow: "0 0 0 2px white, 0 0 6px 2px rgba(16,185,129,0.6)",
                    }}
                    title="Você"
                  />
                );
              })()}
            </div>
            <div className="mt-1 text-[10px] text-white/60 px-0.5">
              Clique numa sala para ir até lá.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
