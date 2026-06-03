import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  GRID_COLS,
  GRID_ROWS,
  cellIndex,
  loadOverrides,
  newOverrides,
  saveOverrides,
  clearOverrides,
  type MapOverrides,
} from "@/lib/map-overrides";
import { ZONES, COLLIDERS, FLOOR_POLY, type ZoneId } from "@/lib/office-map";
import officeMap from "@/assets/office-map.jpg";
import { toast } from "sonner";
import { ArrowLeft, Eraser, Square, Download, Trash2, Eye, EyeOff } from "lucide-react";

type Tool =
  | { kind: "blocked" }
  | { kind: "erase" }
  | { kind: "zone"; zone: ZoneId };

// Seed overrides from the hardcoded COLLIDERS + ZONES so the user starts
// with the current layout already painted and can tweak from there.
function seedFromDefaults(): MapOverrides {
  const o = newOverrides();
  // Blocked tiles from COLLIDERS rectangles.
  for (const c of COLLIDERS) {
    const c0 = Math.max(0, Math.floor(c.x1 * o.cols));
    const c1 = Math.min(o.cols - 1, Math.ceil(c.x2 * o.cols) - 1);
    const r0 = Math.max(0, Math.floor(c.y1 * o.rows));
    const r1 = Math.min(o.rows - 1, Math.ceil(c.y2 * o.rows) - 1);
    for (let r = r0; r <= r1; r++) {
      for (let cc = c0; cc <= c1; cc++) {
        o.blocked[cellIndex(cc, r, o.cols)] = 1;
      }
    }
  }
  // Zones from ZONES rectangles (skip lobby).
  for (const z of ZONES) {
    if (z.id === "lobby") continue;
    const c0 = Math.max(0, Math.floor(z.rect.x1 * o.cols));
    const c1 = Math.min(o.cols - 1, Math.ceil(z.rect.x2 * o.cols) - 1);
    const r0 = Math.max(0, Math.floor(z.rect.y1 * o.rows));
    const r1 = Math.min(o.rows - 1, Math.ceil(z.rect.y2 * o.rows) - 1);
    for (let r = r0; r <= r1; r++) {
      for (let cc = c0; cc <= c1; cc++) {
        o.zones[cellIndex(cc, r, o.cols)] = z.id;
      }
    }
  }
  return o;
}

const ZONE_COLORS: Record<string, string> = {
  descompressao: "#22c55e",
  diretoria: "#a855f7",
  reuniao: "#f59e0b",
  supervisao: "#06b6d4",
  feedback: "#ef4444",
  "atendente-1": "#ec4899",
  "atendente-2": "#f43f5e",
  "atendente-3": "#f97316",
  "atendente-4": "#eab308",
  "atendente-5": "#84cc16",
  "atendente-6": "#10b981",
  "atendente-7": "#14b8a6",
  "atendente-8": "#0ea5e9",
  "atendente-9": "#6366f1",
  "atendente-10": "#8b5cf6",
};

export function MapEditor() {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [overrides, setOverrides] = useState<MapOverrides>(() => {
    return loadOverrides() ?? seedFromDefaults();
  });
  const [tool, setTool] = useState<Tool>({ kind: "blocked" });
  const [brush, setBrush] = useState(1);
  const [showGrid, setShowGrid] = useState(true);
  const [showImage, setShowImage] = useState(true);
  const [showEffective, setShowEffective] = useState(true);
  const [dirty, setDirty] = useState(!loadOverrides());
  const painting = useRef(false);

  const paintableZones = useMemo(
    () => ZONES.filter((z) => z.id !== "lobby"),
    []
  );

  const paintCell = useCallback(
    (col: number, row: number) => {
      setOverrides((prev) => {
        const next: MapOverrides = {
          ...prev,
          blocked: prev.blocked.slice(),
          zones: prev.zones.slice(),
        };
        const half = Math.floor(brush / 2);
        for (let dr = -half; dr <= brush - 1 - half; dr++) {
          for (let dc = -half; dc <= brush - 1 - half; dc++) {
            const r = row + dr;
            const c = col + dc;
            if (r < 0 || r >= next.rows || c < 0 || c >= next.cols) continue;
            const idx = cellIndex(c, r, next.cols);
            if (tool.kind === "blocked") {
              next.blocked[idx] = 1;
            } else if (tool.kind === "erase") {
              next.blocked[idx] = 0;
              next.zones[idx] = null;
            } else if (tool.kind === "zone") {
              next.zones[idx] = tool.zone;
            }
          }
        }
        return next;
      });
      setDirty(true);
    },
    [brush, tool]
  );

  const handlePointer = useCallback(
    (e: React.PointerEvent) => {
      if (!stageRef.current) return;
      const rect = stageRef.current.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      const y = (e.clientY - rect.top) / rect.height;
      const col = Math.max(0, Math.min(GRID_COLS - 1, Math.floor(x * GRID_COLS)));
      const row = Math.max(0, Math.min(GRID_ROWS - 1, Math.floor(y * GRID_ROWS)));
      paintCell(col, row);
    },
    [paintCell]
  );

  const save = useCallback(() => {
    saveOverrides(overrides);
    setDirty(false);
    toast.success("Mapa salvo. Volte ao escritório para ver as mudanças.");
  }, [overrides]);

  const reset = useCallback(() => {
    if (!confirm("Limpar todas as células pintadas?")) return;
    setOverrides(newOverrides());
    setDirty(true);
  }, []);

  const reseed = useCallback(() => {
    if (!confirm("Recarregar layout padrão (descarta alterações)?")) return;
    setOverrides(seedFromDefaults());
    setDirty(true);
  }, []);

  const clearSaved = useCallback(() => {
    if (!confirm("Remover overrides salvos? O mapa voltará ao padrão.")) return;
    clearOverrides();
    setOverrides(seedFromDefaults());
    setDirty(true);
    toast.success("Overrides removidos.");
  }, []);

  const exportJson = useCallback(() => {
    const blob = new Blob([JSON.stringify(overrides)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "office-map-overrides.json";
    a.click();
    URL.revokeObjectURL(url);
  }, [overrides]);

  // Pre-render tiles as plain divs would be huge (2560+). Use a canvas overlay.
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const effectiveCanvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const cols = overrides.cols;
    const rows = overrides.rows;
    canvas.width = cols;
    canvas.height = rows;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, cols, rows);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = cellIndex(c, r, cols);
        const zid = overrides.zones[i];
        if (zid) {
          ctx.fillStyle = (ZONE_COLORS[zid] ?? "#fff") + "66"; // ~40% alpha
          ctx.fillRect(c, r, 1, 1);
        }
        if (overrides.blocked[i]) {
          ctx.fillStyle = "rgba(239, 68, 68, 0.55)"; // red
          ctx.fillRect(c, r, 1, 1);
        }
      }
    }
  }, [overrides]);

  // Effective-collision overlay: shows EXACTLY what the game blocks for
  // the avatar (FLOOR_POLY + painted blocked OR default COLLIDERS).
  // This is the source of truth for calibration so painted area === in-game blocked area.
  useEffect(() => {
    const canvas = effectiveCanvasRef.current;
    if (!canvas) return;
    const cols = overrides.cols;
    const rows = overrides.rows;
    canvas.width = cols;
    canvas.height = rows;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, cols, rows);
    if (!showEffective) return;

    const hasPainted = overrides.blocked.some((b) => b === 1);

    const pointInPoly = (px: number, py: number) => {
      let inside = false;
      for (let i = 0, j = FLOOR_POLY.length - 1; i < FLOOR_POLY.length; j = i++) {
        const xi = FLOOR_POLY[i].x, yi = FLOOR_POLY[i].y;
        const xj = FLOOR_POLY[j].x, yj = FLOOR_POLY[j].y;
        const intersect = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
        if (intersect) inside = !inside;
      }
      return inside;
    };

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const px = (c + 0.5) / cols;
        const py = (r + 0.5) / rows;
        let blocked = !pointInPoly(px, py);
        if (!blocked) {
          if (hasPainted) {
            blocked = overrides.blocked[cellIndex(c, r, cols)] === 1;
          } else {
            for (const co of COLLIDERS) {
              if (px > co.x1 && px < co.x2 && py > co.y1 && py < co.y2) {
                blocked = true;
                break;
              }
            }
          }
        }
        if (blocked) {
          // Yellow outline-style — distinct from the red paint layer.
          ctx.fillStyle = "rgba(250, 204, 21, 0.35)";
          ctx.fillRect(c, r, 1, 1);
        }
      }
    }
  }, [overrides, showEffective]);

  return (
    <div className="h-screen w-screen flex flex-col bg-background text-foreground">
      {/* Toolbar */}
      <header className="flex items-center gap-3 px-4 py-2 border-b border-border bg-card flex-wrap">
        <Link
          to="/office"
          className="inline-flex items-center gap-1 text-sm px-2 py-1 rounded hover:bg-muted"
        >
          <ArrowLeft size={16} /> Voltar
        </Link>
        <span className="text-sm font-semibold">Editor de Mapa</span>
        <span className="text-xs text-muted-foreground">
          {GRID_COLS}×{GRID_ROWS} células
        </span>

        <div className="ml-4 flex items-center gap-1">
          <ToolBtn
            active={tool.kind === "blocked"}
            onClick={() => setTool({ kind: "blocked" })}
            icon={<Square size={14} />}
            label="Bloqueado"
            color="#ef4444"
          />
          <ToolBtn
            active={tool.kind === "erase"}
            onClick={() => setTool({ kind: "erase" })}
            icon={<Eraser size={14} />}
            label="Apagar"
          />
        </div>

        <div className="flex items-center gap-1 ml-2">
          <span className="text-xs text-muted-foreground">Pincel</span>
          {[1, 2, 3, 5].map((b) => (
            <button
              key={b}
              onClick={() => setBrush(b)}
              className={`text-xs px-2 py-1 rounded ${
                brush === b ? "bg-primary text-primary-foreground" : "bg-muted"
              }`}
            >
              {b}×{b}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => setShowImage((v) => !v)}
            className="text-xs px-2 py-1 rounded bg-muted inline-flex items-center gap-1"
          >
            {showImage ? <Eye size={12} /> : <EyeOff size={12} />} Imagem
          </button>
          <button
            onClick={() => setShowGrid((v) => !v)}
            className="text-xs px-2 py-1 rounded bg-muted inline-flex items-center gap-1"
          >
            {showGrid ? <Eye size={12} /> : <EyeOff size={12} />} Grid
          </button>
          <button
            onClick={() => setShowEffective((v) => !v)}
            className={`text-xs px-2 py-1 rounded inline-flex items-center gap-1 ${
              showEffective ? "bg-yellow-500/30 text-yellow-100" : "bg-muted"
            }`}
            title="Mostra o bloqueio EXATO que o jogo aplica (polígono do piso + colisões)"
          >
            {showEffective ? <Eye size={12} /> : <EyeOff size={12} />} Bloqueio do jogo
          </button>
          <button onClick={exportJson} className="text-xs px-2 py-1 rounded bg-muted inline-flex items-center gap-1">
            <Download size={12} /> Export
          </button>
          <button onClick={reseed} className="text-xs px-2 py-1 rounded bg-muted">
            Recarregar padrão
          </button>
          <button onClick={reset} className="text-xs px-2 py-1 rounded bg-muted inline-flex items-center gap-1">
            <Trash2 size={12} /> Limpar
          </button>
          <button onClick={clearSaved} className="text-xs px-2 py-1 rounded bg-muted">
            Remover overrides
          </button>
          <button
            onClick={save}
            className={`text-sm px-3 py-1.5 rounded font-semibold ${
              dirty ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
            }`}
          >
            {dirty ? "Salvar" : "Salvo"}
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Zone palette */}
        <aside className="w-56 border-r border-border bg-card p-3 overflow-y-auto">
          <h3 className="text-xs font-semibold uppercase text-muted-foreground mb-2">Zonas (Áreas privadas)</h3>
          <div className="flex flex-col gap-1">
            {paintableZones.map((z) => {
              const color = ZONE_COLORS[z.id] ?? "#888";
              const active = tool.kind === "zone" && tool.zone === z.id;
              return (
                <button
                  key={z.id}
                  onClick={() => setTool({ kind: "zone", zone: z.id })}
                  className={`flex items-center gap-2 px-2 py-1.5 rounded text-left text-sm ${
                    active ? "ring-2 ring-primary bg-muted" : "hover:bg-muted"
                  }`}
                >
                  <span
                    className="w-4 h-4 rounded shrink-0"
                    style={{ backgroundColor: color, opacity: 0.7 }}
                  />
                  <span className="truncate">{z.label}</span>
                </button>
              );
            })}
          </div>

          <h3 className="text-xs font-semibold uppercase text-muted-foreground mt-4 mb-2">Legenda</h3>
          <div className="text-xs text-muted-foreground space-y-1">
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded" style={{ background: "rgba(239,68,68,0.55)" }} />
              Bloqueado
            </div>
            <div>
              <p className="mt-2">Clique e arraste para pintar. Use Apagar para limpar célula.</p>
            </div>
          </div>
        </aside>

        {/* Stage */}
        <main className="flex-1 overflow-auto bg-neutral-900 p-4">
          <div
            ref={stageRef}
            className="relative mx-auto select-none cursor-crosshair"
            style={{ aspectRatio: "1536 / 1024", width: "min(100%, calc((100vh - 110px) * 1.5))" }}
            onPointerDown={(e) => {
              (e.target as Element).setPointerCapture?.(e.pointerId);
              painting.current = true;
              handlePointer(e);
            }}
            onPointerMove={(e) => {
              if (painting.current) handlePointer(e);
            }}
            onPointerUp={() => (painting.current = false)}
            onPointerCancel={() => (painting.current = false)}
          >
            {showImage && (
              <img
                src={officeMap}
                alt=""
                className="absolute inset-0 w-full h-full object-cover pointer-events-none"
                draggable={false}
              />
            )}
            {/* Painted tiles via canvas, scaled pixelated */}
            <canvas
              ref={canvasRef}
              className="absolute inset-0 w-full h-full pointer-events-none"
              style={{ imageRendering: "pixelated" }}
            />
            {/* Effective game-collision overlay (FLOOR_POLY + colliders/painted) */}
            <canvas
              ref={effectiveCanvasRef}
              className="absolute inset-0 w-full h-full pointer-events-none"
              style={{ imageRendering: "pixelated", mixBlendMode: "screen" }}
            />
            {/* Grid overlay */}
            {showGrid && (
              <div
                className="absolute inset-0 pointer-events-none"
                style={{
                  backgroundImage:
                    "linear-gradient(to right, rgba(255,255,255,0.18) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.18) 1px, transparent 1px)",
                  backgroundSize: `${100 / GRID_COLS}% ${100 / GRID_ROWS}%`,
                }}
              />
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

function ToolBtn({
  active,
  onClick,
  icon,
  label,
  color,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  color?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded ${
        active ? "ring-2 ring-primary bg-muted" : "bg-muted/60 hover:bg-muted"
      }`}
    >
      {color && <span className="w-3 h-3 rounded-sm" style={{ background: color }} />}
      {icon}
      {label}
    </button>
  );
}
