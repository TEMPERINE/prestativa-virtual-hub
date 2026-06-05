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
  pullOverridesFromCloud,
  pushOverridesToCloud,
  clearOverridesInCloud,
  type MapOverrides,
  type CustomZone,
  type ZoneKind,
  type PropInstance,
  type PropAction,
} from "@/lib/map-overrides";
import { ZONES, COLLIDERS, FLOOR_POLY, type ZoneId } from "@/lib/office-map";
import { PROP_CATALOG, getPropDef } from "@/lib/prop-catalog";
import officeMap from "@/assets/office-map.jpg";
import { toast } from "sonner";
import { ArrowLeft, Eraser, Square, Download, Trash2, Eye, EyeOff, Undo, Plus, X, Briefcase, Users, MapPin, Hand, Zap, ZapOff, Lock, Map as MapIcon, Boxes, LayoutGrid } from "lucide-react";

type Tool =
  | { kind: "blocked" }
  | { kind: "erase" }
  | { kind: "zone"; zone: ZoneId }
  | { kind: "spawn"; zone: string }
  | { kind: "place-prop"; defId: string }
  | { kind: "select" };

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
  const mainRef = useRef<HTMLElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [overrides, setOverrides] = useState<MapOverrides>(() => {
    return loadOverrides() ?? seedFromDefaults();
  });
  const [tool, setTool] = useState<Tool>({ kind: "blocked" });
  const [editorTab, setEditorTab] = useState<"map" | "zones" | "elements">("map");
  const [brush, setBrush] = useState(1);
  const [showGrid, setShowGrid] = useState(true);
  const [showImage, setShowImage] = useState(true);
  const [showEffective, setShowEffective] = useState(true);
  const [dirty, setDirty] = useState(!loadOverrides());
  const painting = useRef(false);
  const historyRef = useRef<MapOverrides[]>([]);
  const [canUndo, setCanUndo] = useState(false);

  // Mouse-wheel zoom (anchored to cursor) for precise painting.
  useEffect(() => {
    const main = mainRef.current;
    if (!main) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const stage = stageRef.current;
      if (!stage) return;
      const rect = stage.getBoundingClientRect();
      // Position of cursor within the (already scaled) stage, in stage-local px.
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      setZoom((z) => {
        const next = Math.max(1, Math.min(8, z * factor));
        const ratio = next / z;
        // Adjust scroll so the point under the cursor stays put.
        requestAnimationFrame(() => {
          main.scrollLeft += sx * (ratio - 1);
          main.scrollTop += sy * (ratio - 1);
        });
        return next;
      });
    };
    main.addEventListener("wheel", onWheel, { passive: false });
    return () => main.removeEventListener("wheel", onWheel);
  }, []);


  const customZones = overrides.customZones ?? [];

  const paintableZones = useMemo(
    () => ZONES.filter((z) => z.id !== "lobby"),
    []
  );

  const zoneColorOf = useCallback(
    (id: string) => {
      const custom = customZones.find((c) => c.id === id);
      if (custom) return custom.color;
      return ZONE_COLORS[id] ?? "#888";
    },
    [customZones]
  );

  // Default zone kinds shown in the editor (mirror map-overrides defaults).
  const defaultKindOf = useCallback((id: string): ZoneKind => {
    if (id === "lobby" || id === "reuniao" || id === "feedback" || id === "descompressao") return "common";
    return "workspace";
  }, []);

  const kindOf = useCallback(
    (id: string): ZoneKind => {
      const ov = overrides.zoneKinds?.[id];
      if (ov) return ov;
      const custom = customZones.find((c) => c.id === id);
      if (custom?.kind) return custom.kind;
      return defaultKindOf(id);
    },
    [overrides.zoneKinds, customZones, defaultKindOf]
  );

  const toggleKind = useCallback((id: string) => {
    setOverrides((prev) => {
      const cur = prev.zoneKinds?.[id]
        ?? prev.customZones?.find((c) => c.id === id)?.kind
        ?? defaultKindOf(id);
      const next: ZoneKind = cur === "workspace" ? "common" : "workspace";
      return { ...prev, zoneKinds: { ...(prev.zoneKinds ?? {}), [id]: next } };
    });
    setDirty(true);
  }, [defaultKindOf]);

  const addCustomZone = useCallback(() => {
    const label = window.prompt("Nome da nova zona:");
    if (!label || !label.trim()) return;
    const palette = ["#22d3ee", "#fb7185", "#a3e635", "#fbbf24", "#c084fc", "#34d399", "#f472b6", "#60a5fa"];
    setOverrides((prev) => {
      const existing = prev.customZones ?? [];
      const id = `custom-${Date.now().toString(36)}`;
      const color = palette[existing.length % palette.length];
      const zone: CustomZone = { id, label: label.trim(), color };
      return { ...prev, customZones: [...existing, zone] };
    });
    setDirty(true);
  }, []);

  const removeCustomZone = useCallback(
    (id: string) => {
      if (!confirm("Remover esta zona e apagar suas células pintadas?")) return;
      setOverrides((prev) => {
        const next: MapOverrides = {
          ...prev,
          zones: prev.zones.map((z) => (z === (id as ZoneId) ? null : z)),
          customZones: (prev.customZones ?? []).filter((c) => c.id !== id),
        };
        return next;
      });
      setTool((t) => (t.kind === "zone" && t.zone === (id as ZoneId) ? { kind: "blocked" } : t));
      setDirty(true);
    },
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
      if (tool.kind === "spawn") {
        const zoneId = tool.zone;
        setOverrides((prev) => ({
          ...prev,
          spawnPoints: { ...(prev.spawnPoints ?? {}), [zoneId]: { x, y } },
        }));
        setDirty(true);
        return;
      }
      if (tool.kind === "place-prop") {
        const def = getPropDef(tool.defId);
        if (!def) return;
        const id = `prop-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
        const inst: PropInstance = {
          id,
          defId: def.id,
          x,
          y,
          w: def.defaultW,
          interactive: def.interactive,
        };
        setOverrides((prev) => ({ ...prev, props: [...(prev.props ?? []), inst] }));
        setSelectedPropId(id);
        setTool({ kind: "select" });
        setDirty(true);
        return;
      }
      if (tool.kind === "select") return;
      const col = Math.max(0, Math.min(GRID_COLS - 1, Math.floor(x * GRID_COLS)));
      const row = Math.max(0, Math.min(GRID_ROWS - 1, Math.floor(y * GRID_ROWS)));
      paintCell(col, row);
    },
    [paintCell, tool]
  );

  const spawnPoints: Record<string, { x: number; y: number }> = overrides.spawnPoints ?? {};
  const draggingPin = useRef<string | null>(null);
  const propsList = overrides.props ?? [];
  const [selectedPropId, setSelectedPropId] = useState<string | null>(null);
  const draggingPropRef = useRef<
    | {
        id: string;
        mode: "move";
        offX: number; // pi.x - mouseNx no início
        offY: number;
        aspect: number;
      }
    | {
        id: string;
        mode: "resize";
        anchorLeft: number; // canto oposto (fixo durante o resize)
        anchorTop: number;
        aspect: number;
      }
    | null
  >(null);
  const [ghostPos, setGhostPos] = useState<{ x: number; y: number } | null>(null);

  const updateProp = useCallback((id: string, patch: Partial<PropInstance>) => {
    setOverrides((prev) => ({
      ...prev,
      props: (prev.props ?? []).map((p) => (p.id === id ? { ...p, ...patch } : p)),
    }));
    setDirty(true);
  }, []);

  const removeProp = useCallback((id: string) => {
    setOverrides((prev) => ({
      ...prev,
      props: (prev.props ?? []).filter((p) => p.id !== id),
    }));
    setSelectedPropId((cur) => (cur === id ? null : cur));
    setDirty(true);
  }, []);

  const togglePropInteractive = useCallback((id: string) => {
    setOverrides((prev) => ({
      ...prev,
      props: (prev.props ?? []).map((p) =>
        p.id === id ? { ...p, interactive: !p.interactive } : p
      ),
    }));
    setDirty(true);
  }, []);

  const addPropAction = useCallback((id: string, action: PropAction) => {
    setOverrides((prev) => ({
      ...prev,
      props: (prev.props ?? []).map((p) => {
        if (p.id !== id) return p;
        const cur = p.actions ?? [];
        // evita duplicar gate-zone para a mesma zona
        if (action.type === "gate-zone" &&
            cur.some((a) => a.type === "gate-zone" && a.zoneId === action.zoneId)) {
          return p;
        }
        return { ...p, actions: [...cur, action] };
      }),
    }));
    setDirty(true);
  }, []);

  const removePropAction = useCallback((id: string, idx: number) => {
    setOverrides((prev) => ({
      ...prev,
      props: (prev.props ?? []).map((p) =>
        p.id === id ? { ...p, actions: (p.actions ?? []).filter((_, i) => i !== idx) } : p
      ),
    }));
    setDirty(true);
  }, []);


  const removeSpawn = useCallback((zoneId: string) => {
    setOverrides((prev) => {
      const cur = { ...(prev.spawnPoints ?? {}) };
      delete cur[zoneId];
      return { ...prev, spawnPoints: cur };
    });
    setDirty(true);
  }, []);

  const moveSpawnToPointer = useCallback((e: React.PointerEvent, zoneId: string) => {
    if (!stageRef.current) return;
    const rect = stageRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    setOverrides((prev) => ({
      ...prev,
      spawnPoints: { ...(prev.spawnPoints ?? {}), [zoneId]: { x, y } },
    }));
    setDirty(true);
  }, []);

  // On mount: pull the latest map from Lovable Cloud so a fresh browser /
  // device sees the same layout instead of falling back to the defaults.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cloud = await pullOverridesFromCloud();
      if (cancelled) return;
      if (cloud) {
        setOverrides(cloud);
        setDirty(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const save = useCallback(async () => {
    saveOverrides(overrides);
    setDirty(false);
    const res = await pushOverridesToCloud(overrides);
    if (res.ok) {
      toast.success("Mapa salvo na nuvem. Visível para todos os usuários.");
    } else {
      toast.error(
        `Salvo localmente, mas falhou ao enviar pra nuvem: ${res.error ?? "erro desconhecido"}`
      );
    }
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

  const clearSaved = useCallback(async () => {
    if (!confirm("Remover overrides salvos (local e nuvem)? O mapa voltará ao padrão.")) return;
    clearOverrides();
    await clearOverridesInCloud();
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

  const pushHistory = useCallback((snapshot: MapOverrides) => {
    historyRef.current.push(snapshot);
    if (historyRef.current.length > 50) historyRef.current.shift();
    setCanUndo(true);
  }, []);

  const undo = useCallback(() => {
    const hist = historyRef.current;
    if (hist.length === 0) return;
    const prev = hist.pop()!;
    setOverrides(prev);
    setCanUndo(hist.length > 0);
    setDirty(true);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && (e.key === "z" || e.key === "Z")) {
        e.preventDefault();
        undo();
      } else if (e.key === "Escape") {
        if (tool.kind === "place-prop" || tool.kind === "spawn") {
          setTool({ kind: "blocked" });
        }
        setSelectedPropId(null);
      } else if ((e.key === "Delete" || e.key === "Backspace") && selectedPropId) {
        const target = e.target as HTMLElement | null;
        const tag = target?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;
        e.preventDefault();
        removeProp(selectedPropId);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, tool, selectedPropId, removeProp]);

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
          ctx.fillStyle = zoneColorOf(zid) + "66"; // ~40% alpha
          ctx.fillRect(c, r, 1, 1);
        }
        if (overrides.blocked[i]) {
          ctx.fillStyle = "rgba(239, 68, 68, 0.55)"; // red
          ctx.fillRect(c, r, 1, 1);
        }
      }
    }
  }, [overrides, zoneColorOf]);

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
          ctx.fillStyle = "rgba(250, 204, 21, 0.55)";
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
          <button
            onClick={undo}
            disabled={!canUndo}
            className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded ${
              canUndo ? "bg-muted/60 hover:bg-muted" : "opacity-50 cursor-not-allowed"
            }`}
            title="Desfazer (Ctrl+Z)"
          >
            <Undo size={14} />
            Desfazer
          </button>
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
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-semibold uppercase text-muted-foreground">Zonas (Áreas privadas)</h3>
            <button
              onClick={addCustomZone}
              title="Adicionar nova zona"
              className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-primary/20 text-primary hover:bg-primary/30"
            >
              <Plus size={12} /> Nova
            </button>
          </div>
          <div className="flex flex-col gap-1">
            {paintableZones.map((z) => {
              const color = ZONE_COLORS[z.id] ?? "#888";
              const active = tool.kind === "zone" && tool.zone === z.id;
              const k = kindOf(z.id);
              return (
                <div
                  key={z.id}
                  className={`group flex items-center gap-2 px-2 py-1.5 rounded text-sm ${
                    active ? "ring-2 ring-primary bg-muted" : "hover:bg-muted"
                  }`}
                >
                  <button
                    onClick={() => setTool({ kind: "zone", zone: z.id })}
                    className="flex items-center gap-2 flex-1 min-w-0 text-left"
                  >
                    <span
                      className="w-4 h-4 rounded shrink-0"
                      style={{ backgroundColor: color, opacity: 0.7 }}
                    />
                    <span className="truncate">{z.label}</span>
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); setTool({ kind: "spawn", zone: z.id }); }}
                    title={spawnPoints[z.id] ? "Ponto de teleporte definido. Clique para reposicionar." : "Definir ponto de teleporte (GPS)"}
                    className={`shrink-0 p-1 rounded ${
                      tool.kind === "spawn" && tool.zone === z.id
                        ? "ring-2 ring-primary text-primary"
                        : spawnPoints[z.id] ? "text-primary" : "text-muted-foreground"
                    } hover:bg-muted`}
                  >
                    <MapPin size={12} />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); toggleKind(z.id); }}
                    title={k === "workspace" ? "Local de trabalho (reivindicável). Clique para tornar Espaço comum." : "Espaço comum. Clique para tornar Local de trabalho."}
                    className={`shrink-0 p-1 rounded ${k === "workspace" ? "text-primary" : "text-muted-foreground"} hover:bg-muted`}
                  >
                    {k === "workspace" ? <Briefcase size={12} /> : <Users size={12} />}
                  </button>
                </div>
              );
            })}
            {customZones.length > 0 && (
              <div className="mt-2 pt-2 border-t border-border/50 flex flex-col gap-1">
                <span className="text-[10px] uppercase text-muted-foreground px-1">Personalizadas</span>
                {customZones.map((z) => {
                  const active = tool.kind === "zone" && tool.zone === (z.id as ZoneId);
                  const k = kindOf(z.id);
                  return (
                    <div
                      key={z.id}
                      className={`group flex items-center gap-2 px-2 py-1.5 rounded text-left text-sm ${
                        active ? "ring-2 ring-primary bg-muted" : "hover:bg-muted"
                      }`}
                    >
                      <button
                        onClick={() => setTool({ kind: "zone", zone: z.id as ZoneId })}
                        className="flex items-center gap-2 flex-1 min-w-0"
                      >
                        <span
                          className="w-4 h-4 rounded shrink-0"
                          style={{ backgroundColor: z.color, opacity: 0.7 }}
                        />
                        <span className="truncate">{z.label}</span>
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); setTool({ kind: "spawn", zone: z.id }); }}
                        title={spawnPoints[z.id] ? "Ponto de teleporte definido" : "Definir ponto de teleporte (GPS)"}
                        className={`shrink-0 p-1 rounded ${
                          tool.kind === "spawn" && tool.zone === z.id
                            ? "ring-2 ring-primary text-primary"
                            : spawnPoints[z.id] ? "text-primary" : "text-muted-foreground"
                        } hover:bg-muted`}
                      >
                        <MapPin size={12} />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); toggleKind(z.id); }}
                        title={k === "workspace" ? "Local de trabalho (reivindicável)" : "Espaço comum"}
                        className={`shrink-0 p-1 rounded ${k === "workspace" ? "text-primary" : "text-muted-foreground"} hover:bg-muted`}
                      >
                        {k === "workspace" ? <Briefcase size={12} /> : <Users size={12} />}
                      </button>
                      <button
                        onClick={() => removeCustomZone(z.id)}
                        title="Remover zona"
                        className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
            <button
              onClick={addCustomZone}
              className="mt-2 inline-flex items-center justify-center gap-1 text-xs px-2 py-1.5 rounded border border-dashed border-border hover:bg-muted text-muted-foreground"
            >
              <Plus size={12} /> Adicionar zona
            </button>
          </div>

          {/* ===== Galeria de elementos ===== */}
          <div className="mt-4 pt-3 border-t border-border/60">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-semibold uppercase text-muted-foreground">Elementos</h3>
              <button
                onClick={() => setTool({ kind: "select" })}
                title="Selecionar / mover elementos"
                className={`p-1 rounded ${tool.kind === "select" ? "ring-2 ring-primary text-primary" : "text-muted-foreground hover:bg-muted"}`}
              >
                <Hand size={12} />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {PROP_CATALOG.map((def) => {
                const active = tool.kind === "place-prop" && tool.defId === def.id;
                return (
                  <button
                    key={def.id}
                    onClick={() => setTool({ kind: "place-prop", defId: def.id })}
                    className={`flex flex-col items-center gap-1 p-2 rounded border ${active ? "border-primary bg-primary/10" : "border-border hover:bg-muted"}`}
                    title={`Adicionar ${def.label}`}
                  >
                    <img src={def.frames[0]} alt="" className="h-12 object-contain" draggable={false} />
                    <span className="text-[10px]">{def.label}</span>
                  </button>
                );
              })}
            </div>
            {tool.kind === "place-prop" && (
              <p className="text-[10px] text-muted-foreground mt-2">
                Clique no mapa para colocar. Esc para cancelar.
              </p>
            )}
            {propsList.length > 0 && (
              <div className="mt-3 flex flex-col gap-1">
                <span className="text-[10px] uppercase text-muted-foreground">No mapa ({propsList.length})</span>
                {propsList.map((pi) => {
                  const def = getPropDef(pi.defId);
                  if (!def) return null;
                  const sel = selectedPropId === pi.id;
                  return (
                    <div
                      key={pi.id}
                      className={`group flex items-center gap-2 px-2 py-1 rounded text-xs ${sel ? "bg-muted ring-1 ring-primary" : "hover:bg-muted"}`}
                    >
                      <button
                        onClick={() => { setTool({ kind: "select" }); setSelectedPropId(pi.id); }}
                        className="flex-1 text-left truncate"
                      >
                        {def.label}
                      </button>
                      {def.interactive && (
                        <button
                          onClick={() => togglePropInteractive(pi.id)}
                          title={pi.interactive ? "Interativo (clique para desativar)" : "Não interativo (clique para ativar)"}
                          className={`p-0.5 ${pi.interactive ? "text-primary" : "text-muted-foreground"}`}
                        >
                          {pi.interactive ? <Zap size={12} /> : <ZapOff size={12} />}
                        </button>
                      )}
                      <button
                        onClick={() => removeProp(pi.id)}
                        className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
                        title="Remover"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <h3 className="text-xs font-semibold uppercase text-muted-foreground mt-4 mb-2">Legenda</h3>
          <div className="text-xs text-muted-foreground space-y-1">
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded" style={{ background: "rgba(239,68,68,0.55)" }} />
              Bloqueado
            </div>
            <div>
              <p className="mt-2">Clique e arraste para pintar. Use Apagar para limpar célula. Para mover elementos, ative a ferramenta de seleção.</p>
            </div>
          </div>
        </aside>

        {/* Stage */}
        <main
          ref={mainRef}
          className="flex-1 overflow-auto bg-neutral-900 p-4 relative"
          style={{ overscrollBehavior: "contain" }}
        >
          <div
            ref={stageRef}
            className="relative mx-auto select-none cursor-crosshair"
            style={{
              aspectRatio: "1536 / 1024",
              width: `calc(${zoom} * min(100%, calc((100vh - 110px) * 1.5)))`,
            }}

            onPointerDown={(e) => {
              if (draggingPin.current) return;
              if (draggingPropRef.current) return;
              // No modo seleção, clique no fundo só desseleciona
              if (tool.kind === "select") {
                setSelectedPropId(null);
                return;
              }
              (e.target as Element).setPointerCapture?.(e.pointerId);
              if (tool.kind === "blocked" || tool.kind === "erase" || tool.kind === "zone") {
                painting.current = true;
                pushHistory({
                  ...overrides,
                  blocked: overrides.blocked.slice(),
                  zones: overrides.zones.slice(),
                });
              }
              handlePointer(e);
            }}
            onPointerMove={(e) => {
              if (draggingPin.current) {
                moveSpawnToPointer(e, draggingPin.current);
                return;
              }
              if (!stageRef.current) return;
              const rect = stageRef.current.getBoundingClientRect();
              const nx = (e.clientX - rect.left) / rect.width;
              const ny = (e.clientY - rect.top) / rect.height;
              if (tool.kind === "place-prop") {
                setGhostPos({ x: nx, y: ny });
              }
              if (draggingPropRef.current) {
                const drag = draggingPropRef.current;
                if (drag.mode === "move") {
                  updateProp(drag.id, {
                    x: Math.max(0, Math.min(1, nx + drag.offX)),
                    y: Math.max(0, Math.min(1, ny + drag.offY)),
                  });
                } else {
                  // Resize ancorado no canto oposto (estilo PowerPoint).
                  // anchorLeft/anchorTop ficam fixos; calculamos nova largura
                  // a partir da distância horizontal do cursor até a âncora,
                  // mantendo a proporção.
                  const newW = Math.max(0.01, Math.min(0.8, nx - drag.anchorLeft));
                  const newH = newW / drag.aspect;
                  updateProp(drag.id, {
                    w: newW,
                    x: drag.anchorLeft + newW / 2,
                    y: drag.anchorTop + newH,
                  });
                }
                return;
              }
              if (painting.current) handlePointer(e);
            }}
            onPointerLeave={() => { if (tool.kind === "place-prop") setGhostPos(null); }}
            onPointerUp={() => { painting.current = false; draggingPin.current = null; draggingPropRef.current = null; }}
            onPointerCancel={() => { painting.current = false; draggingPin.current = null; draggingPropRef.current = null; }}
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
            {/* Spawn point pins */}
            {Object.entries(spawnPoints).map(([zid, p]) => {
              const color = zoneColorOf(zid);
              const label = ZONES.find((z) => z.id === zid)?.label
                ?? customZones.find((c) => c.id === zid)?.label
                ?? zid;
              const active = tool.kind === "spawn" && tool.zone === zid;
              return (
                <div
                  key={zid}
                  className="absolute pointer-events-auto"
                  style={{
                    left: `${p.x * 100}%`,
                    top: `${p.y * 100}%`,
                    transform: "translate(-50%, -100%)",
                  }}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    if ((e.target as HTMLElement).closest("button")) return;
                    draggingPin.current = zid;
                    (stageRef.current as Element | null)?.setPointerCapture?.(e.pointerId);
                  }}
                >
                  <div className="flex flex-col items-center -mb-1">
                    <div
                      className="px-1.5 py-0.5 rounded text-[9px] font-medium whitespace-nowrap shadow-soft"
                      style={{ background: color, color: "#0a0a0a" }}
                    >
                      {label}
                    </div>
                    <div className="relative" style={{ cursor: "grab" }}>
                      <MapPin
                        size={active ? 24 : 20}
                        className="drop-shadow"
                        style={{ color, fill: color, stroke: "#0a0a0a", strokeWidth: 1.5 }}
                      />
                      <button
                        type="button"
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => { e.stopPropagation(); removeSpawn(zid); }}
                        title="Remover ponto"
                        className="absolute -top-1 -right-2 bg-card border border-border rounded-full p-0.5 text-muted-foreground hover:text-destructive"
                      >
                        <X size={10} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
            {tool.kind === "spawn" && (
              <div className="absolute top-2 left-1/2 -translate-x-1/2 pointer-events-none bg-primary text-primary-foreground text-xs px-3 py-1 rounded-full shadow-soft">
                Clique no mapa para fixar o ponto · arraste o pino para ajustes finos
              </div>
            )}

            {/* Props (elementos) — render + handles de edição */}
            {propsList.map((pi) => {
              const def = getPropDef(pi.defId);
              if (!def) return null;
              const sel = selectedPropId === pi.id;
              const wPct = pi.w * 100;
              const hPct = (pi.w / def.aspectRatio) * 100;
              const curFrame = pi.frame ?? 0;
              return (
                <div
                  key={pi.id}
                  className="absolute"
                  style={{
                    left: `${pi.x * 100}%`,
                    top: `${pi.y * 100}%`,
                    width: `${wPct}%`,
                    height: `${hPct}%`,
                    transform: "translate(-50%, -100%)",
                    zIndex: 30000 + Math.round(pi.y * 5000),
                    cursor: tool.kind === "select" ? "move" : "default",
                    pointerEvents: tool.kind === "select" ? "auto" : "none",
                  }}
                  onPointerDown={(e) => {
                    if (tool.kind !== "select") return;
                    if (e.button !== 0) return; // só botão esquerdo arrasta
                    e.stopPropagation();
                    setSelectedPropId(pi.id);
                    if (!stageRef.current) return;
                    const rect = stageRef.current.getBoundingClientRect();
                    const nx = (e.clientX - rect.left) / rect.width;
                    const ny = (e.clientY - rect.top) / rect.height;
                    draggingPropRef.current = {
                      id: pi.id,
                      mode: "move",
                      offX: pi.x - nx, // preserva o ponto exato onde o usuário clicou
                      offY: pi.y - ny,
                      aspect: def.aspectRatio,
                    };
                    (stageRef.current as Element | null)?.setPointerCapture?.(e.pointerId);
                  }}
                  onContextMenu={(e) => {
                    if (tool.kind !== "select") return;
                    if (def.frames.length <= 1) return;
                    e.preventDefault();
                    e.stopPropagation();
                    setSelectedPropId(pi.id);
                    const next = (curFrame + 1) % def.frames.length;
                    updateProp(pi.id, { frame: next });
                  }}
                >
                  <img
                    src={def.frames[curFrame] ?? def.frames[0]}
                    alt=""
                    className="w-full h-full object-contain pointer-events-none select-none"
                    draggable={false}
                    style={{ imageRendering: "pixelated" }}
                  />
                  {sel && tool.kind === "select" && (
                    <>
                      <div className="absolute inset-0 ring-2 ring-primary rounded pointer-events-none" />
                      {/* Resize handle (canto inferior direito) — âncora = canto superior esquerdo */}
                      <div
                        className="absolute -right-1 -bottom-1 w-3 h-3 bg-primary border border-card rounded-sm cursor-nwse-resize"
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          if (!stageRef.current) return;
                          const hNorm = pi.w / def.aspectRatio;
                          draggingPropRef.current = {
                            id: pi.id,
                            mode: "resize",
                            anchorLeft: pi.x - pi.w / 2,
                            anchorTop: pi.y - hNorm,
                            aspect: def.aspectRatio,
                          };
                          (stageRef.current as Element | null)?.setPointerCapture?.(e.pointerId);
                        }}
                      />
                      {/* Toolbar flutuante */}
                      <div
                        className="absolute left-1/2 -translate-x-1/2 -top-7 flex items-center gap-1 bg-card border border-border rounded px-1 py-0.5 shadow-soft text-xs whitespace-nowrap"
                        onPointerDown={(e) => e.stopPropagation()}
                        onContextMenu={(e) => e.stopPropagation()}
                      >
                        {def.frames.length > 1 && (
                          <button
                            onClick={() => updateProp(pi.id, { frame: (curFrame + 1) % def.frames.length })}
                            title="Alternar frame padrão (ou clique direito)"
                            className="p-1 rounded text-muted-foreground hover:bg-muted"
                          >
                            <span className="text-[10px] font-mono px-0.5">{curFrame + 1}/{def.frames.length}</span>
                          </button>
                        )}
                        {def.interactive && (
                          <button
                            onClick={() => togglePropInteractive(pi.id)}
                            title={pi.interactive ? "Interativo (clique para desativar)" : "Não interativo (clique para ativar)"}
                            className={`p-1 rounded ${pi.interactive ? "text-primary" : "text-muted-foreground"} hover:bg-muted`}
                          >
                            {pi.interactive ? <Zap size={12} /> : <ZapOff size={12} />}
                          </button>
                        )}
                        <button
                          onClick={() => removeProp(pi.id)}
                          title="Remover"
                          className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-muted"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </>
                  )}
                </div>
              );
            })}

            {/* Preview esmaecida do prop colado ao cursor */}
            {tool.kind === "place-prop" && ghostPos && (() => {
              const def = getPropDef(tool.defId);
              if (!def) return null;
              const wPct = def.defaultW * 100;
              const hPct = (def.defaultW / def.aspectRatio) * 100;
              return (
                <img
                  src={def.frames[0]}
                  alt=""
                  draggable={false}
                  className="absolute pointer-events-none select-none"
                  style={{
                    left: `${ghostPos.x * 100}%`,
                    top: `${ghostPos.y * 100}%`,
                    width: `${wPct}%`,
                    height: `${hPct}%`,
                    transform: "translate(-50%, -100%)",
                    objectFit: "contain",
                    objectPosition: "bottom center",
                    opacity: 0.45,
                    imageRendering: "pixelated",
                    zIndex: 80000,
                    filter: "drop-shadow(0 0 4px rgba(0,0,0,0.5))",
                  }}
                />

              );
            })()}

            {tool.kind === "place-prop" && (
              <div className="absolute top-2 left-1/2 -translate-x-1/2 pointer-events-none bg-primary text-primary-foreground text-xs px-3 py-1 rounded-full shadow-soft">
                Clique no mapa para colocar · Esc para cancelar
              </div>
            )}
          </div>
          {/* Zoom HUD */}
          <div className="sticky bottom-2 ml-auto mr-2 w-fit flex items-center gap-1 bg-card/90 border border-border rounded-full px-2 py-1 text-xs shadow-soft backdrop-blur" style={{ float: "right" }}>
            <button
              type="button"
              onClick={() => setZoom((z) => Math.max(1, z / 1.25))}
              className="px-1.5 rounded hover:bg-muted"
              title="Diminuir zoom"
            >−</button>
            <span className="tabular-nums w-10 text-center">{Math.round(zoom * 100)}%</span>
            <button
              type="button"
              onClick={() => setZoom((z) => Math.min(8, z * 1.25))}
              className="px-1.5 rounded hover:bg-muted"
              title="Aumentar zoom"
            >+</button>
            <button
              type="button"
              onClick={() => setZoom(1)}
              className="ml-1 px-1.5 rounded hover:bg-muted text-muted-foreground"
              title="Resetar zoom"
              disabled={zoom === 1}
            >1×</button>
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
