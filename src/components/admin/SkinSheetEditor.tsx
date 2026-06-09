import { useEffect, useMemo, useRef, useState } from "react";
import {
  sliceSheetFromFile,
  composeFacingSheet,
  FACINGS,
  type Frame,
  type Facing,
  type SliceResult,
} from "@/lib/sprites/sheet-processor";

export type FacingOutput = {
  facing: Facing;
  blob: Blob;
  width: number;
  height: number;
};

type Props = {
  file: File;
  includeRight: boolean;
  onReady: (outputs: FacingOutput[]) => void;
};

/**
 * Editor visual frame-a-frame.
 * - Carrega a folha-fonte e detecta 24 bboxes automaticamente.
 * - Mostra grid 4×6 (ou 3×6 se mirrorRight) de minis sobre o canvas limpo.
 * - Clica num frame → edita bbox + centro + linha do pé com handles arrastáveis.
 * - Botão "Aplicar e gerar PNGs" emite blobs prontos pra upload.
 */
export function SkinSheetEditor({ file, includeRight, onReady }: Props) {
  const [slice, setSlice] = useState<SliceResult | null>(null);
  const [frames, setFrames] = useState<Frame[]>([]);
  const [selected, setSelected] = useState<number>(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSlice(null);
    setBusy(true);
    sliceSheetFromFile(file, { includeRight })
      .then((s) => {
        if (cancelled) return;
        setSlice(s);
        setFrames(s.frames);
        setSelected(0);
        setBusy(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setErr(e?.message ?? "Falha ao processar imagem");
        setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [file, includeRight]);

  const cleanedUrl = useMemo(
    () => (slice ? slice.cleanedCanvas.toDataURL("image/png") : null),
    [slice],
  );

  const updateFrame = (i: number, patch: Partial<Frame>) => {
    setFrames((p) => {
      const next = [...p];
      next[i] = { ...next[i], ...patch, edited: true };
      return next;
    });
  };

  const handleGenerate = async () => {
    if (!slice) return;
    setBusy(true);
    try {
      const facingsToEmit = includeRight ? FACINGS : (["down", "up", "left"] as Facing[]);
      const outputs: FacingOutput[] = [];
      for (const f of facingsToEmit) {
        const { blob, w, h } = composeFacingSheet(slice.cleanedCanvas, frames, f);
        outputs.push({ facing: f, blob: await blob, width: w, height: h });
      }
      onReady(outputs);
    } catch (e: any) {
      setErr(e?.message ?? "Falha ao gerar PNGs");
    }
    setBusy(false);
  };

  if (err) return <div className="text-sm text-red-500">{err}</div>;
  if (busy && !slice) return <div className="text-sm text-muted-foreground">Detectando frames…</div>;
  if (!slice || !cleanedUrl) return null;

  return (
    <div className="space-y-4">
      <p className="text-[11px] text-muted-foreground">
        Layout {slice.rows}×{slice.cols}. Os {frames.length} frames foram detectados automaticamente.
        Clique em qualquer frame pra ajustar o recorte; arraste as bordas pra redimensionar ou o miolo pra mover.
      </p>

      <FrameGrid
        slice={slice}
        cleanedUrl={cleanedUrl}
        frames={frames}
        selected={selected}
        onSelect={setSelected}
      />

      <FrameEditor
        slice={slice}
        cleanedUrl={cleanedUrl}
        frame={frames[selected]}
        index={selected}
        onChange={(patch) => updateFrame(selected, patch)}
        onResetAuto={async () => {
          // refaz auto só desse frame
          const f = frames[selected];
          if (!f) return;
          const r = FACINGS.indexOf(f.facing);
          const sub = await sliceSheetFromFile(file, { includeRight });
          const fresh = sub.frames.find((x) => x.facing === f.facing && x.col === f.col);
          if (fresh) updateFrame(selected, { ...fresh, edited: false });
        }}
      />

      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleGenerate}
          disabled={busy}
          className="px-4 py-2 rounded-lg gradient-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
        >
          {busy ? "Gerando…" : "Aplicar recortes e preparar PNGs"}
        </button>
      </div>
    </div>
  );
}

/* --------------------------------- grid --------------------------------- */

function FrameGrid({
  slice,
  cleanedUrl,
  frames,
  selected,
  onSelect,
}: {
  slice: SliceResult;
  cleanedUrl: string;
  frames: Frame[];
  selected: number;
  onSelect: (i: number) => void;
}) {
  const facings = Array.from(new Set(frames.map((f) => f.facing)));
  return (
    <div className="space-y-2">
      {facings.map((facing) => (
        <div key={facing} className="flex items-center gap-2">
          <div className="w-12 text-[10px] uppercase tracking-wider text-muted-foreground">{facing}</div>
          <div className="flex gap-1.5 flex-wrap">
            {frames
              .map((f, i) => ({ f, i }))
              .filter((x) => x.f.facing === facing)
              .map(({ f, i }) => {
                const w = f.x1 - f.x0;
                const h = f.y1 - f.y0;
                const isSel = i === selected;
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => onSelect(i)}
                    className={`relative w-14 h-20 rounded border overflow-hidden bg-muted/30 ${
                      isSel ? "border-primary ring-1 ring-primary" : "border-border"
                    }`}
                    title={`${facing} ${f.col}${f.edited ? " (editado)" : ""}`}
                  >
                    <div
                      style={{
                        width: "100%",
                        height: "100%",
                        backgroundImage: `url(${cleanedUrl})`,
                        backgroundRepeat: "no-repeat",
                        backgroundPosition: `-${(f.x0 / w) * 56}px -${(f.y0 / h) * 80}px`,
                        backgroundSize: `${(slice.cleanedCanvas.width / w) * 56}px ${
                          (slice.cleanedCanvas.height / h) * 80
                        }px`,
                        imageRendering: "auto",
                      }}
                    />
                    {f.edited && (
                      <span className="absolute top-0 right-0 text-[8px] bg-primary text-primary-foreground px-1">
                        ✎
                      </span>
                    )}
                  </button>
                );
              })}
          </div>
        </div>
      ))}
    </div>
  );
}

/* -------------------------------- editor -------------------------------- */

function FrameEditor({
  slice,
  cleanedUrl,
  frame,
  index,
  onChange,
  onResetAuto,
}: {
  slice: SliceResult;
  cleanedUrl: string;
  frame: Frame | undefined;
  index: number;
  onChange: (patch: Partial<Frame>) => void;
  onResetAuto: () => void;
}) {
  // Render o frame ampliado: queremos um viewport que sempre mostra a célula
  // bruta da folha (linha+coluna), com a bbox como retângulo arrastável.
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<{
    kind: "move" | "left" | "right" | "top" | "bottom" | "cx" | "foot" | null;
    startX: number;
    startY: number;
    orig: Frame;
  } | null>(null);

  if (!frame) return null;

  const cellH = slice.cellH;
  const cellW = slice.cellW;
  const facingRow = FACINGS.indexOf(frame.facing);
  const cellX = frame.col * cellW;
  const cellY = facingRow * cellH;

  // viewport tamanho fixo, escala calculada
  const VW = 280;
  const VH = 360;
  const scale = Math.min(VW / (cellW * 1.3), VH / (cellH * 1.3));
  const offX = VW / 2 - (cellX + cellW / 2) * scale;
  const offY = VH / 2 - (cellY + cellH / 2) * scale;

  const toView = (x: number, y: number) => ({ x: x * scale + offX, y: y * scale + offY });
  const fromViewDelta = (dx: number, dy: number) => ({ dx: dx / scale, dy: dy / scale });

  const tl = toView(frame.x0, frame.y0);
  const br = toView(frame.x1, frame.y1);
  const center = toView(frame.x0 + frame.cx, frame.y0);
  const foot = toView(frame.x0, frame.y0 + frame.footY);

  const onMouseDown = (kind: NonNullable<typeof dragging.current>["kind"]) => (e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = { kind, startX: e.clientX, startY: e.clientY, orig: { ...frame } };
    const move = (ev: MouseEvent) => {
      if (!dragging.current) return;
      const { startX, startY, orig, kind } = dragging.current;
      const { dx, dy } = fromViewDelta(ev.clientX - startX, ev.clientY - startY);
      const patch: Partial<Frame> = {};
      if (kind === "move") {
        patch.x0 = orig.x0 + dx;
        patch.x1 = orig.x1 + dx;
        patch.y0 = orig.y0 + dy;
        patch.y1 = orig.y1 + dy;
      } else if (kind === "left") {
        patch.x0 = Math.min(orig.x1 - 4, orig.x0 + dx);
        patch.cx = orig.cx - (Math.min(orig.x1 - 4, orig.x0 + dx) - orig.x0);
      } else if (kind === "right") {
        patch.x1 = Math.max(orig.x0 + 4, orig.x1 + dx);
      } else if (kind === "top") {
        patch.y0 = Math.min(orig.y1 - 4, orig.y0 + dy);
        patch.footY = orig.footY - (Math.min(orig.y1 - 4, orig.y0 + dy) - orig.y0);
      } else if (kind === "bottom") {
        patch.y1 = Math.max(orig.y0 + 4, orig.y1 + dy);
        patch.footY = patch.y1 - orig.y0;
      } else if (kind === "cx") {
        patch.cx = Math.max(0, Math.min(orig.x1 - orig.x0, orig.cx + dx));
      } else if (kind === "foot") {
        patch.footY = Math.max(0, Math.min(orig.y1 - orig.y0, orig.footY + dy));
      }
      onChange(patch);
    };
    const up = () => {
      dragging.current = null;
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  return (
    <div className="grid sm:grid-cols-[auto_1fr] gap-4 p-3 rounded-lg border border-border bg-muted/20">
      <div
        ref={containerRef}
        className="relative rounded-md overflow-hidden bg-[length:20px_20px]"
        style={{
          width: VW,
          height: VH,
          backgroundColor: "#1a1a1a",
          backgroundImage:
            "linear-gradient(45deg,#222 25%,transparent 25%),linear-gradient(-45deg,#222 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#222 75%),linear-gradient(-45deg,transparent 75%,#222 75%)",
          backgroundPosition: "0 0,0 10px,10px -10px,-10px 0px",
        }}
      >
        <img
          src={cleanedUrl}
          alt=""
          style={{
            position: "absolute",
            left: offX,
            top: offY,
            width: slice.cleanedCanvas.width * scale,
            height: slice.cleanedCanvas.height * scale,
            imageRendering: "pixelated",
            pointerEvents: "none",
            userSelect: "none",
          }}
        />
        {/* célula bruta */}
        <div
          style={{
            position: "absolute",
            left: toView(cellX, cellY).x,
            top: toView(cellX, cellY).y,
            width: cellW * scale,
            height: cellH * scale,
            border: "1px dashed rgba(255,255,255,0.2)",
            pointerEvents: "none",
          }}
        />
        {/* bbox */}
        <div
          onMouseDown={onMouseDown("move")}
          style={{
            position: "absolute",
            left: tl.x,
            top: tl.y,
            width: br.x - tl.x,
            height: br.y - tl.y,
            border: "1.5px solid hsl(var(--primary))",
            cursor: "move",
            background: "transparent",
          }}
        >
          {/* handles */}
          <Handle pos="left" onDown={onMouseDown("left")} />
          <Handle pos="right" onDown={onMouseDown("right")} />
          <Handle pos="top" onDown={onMouseDown("top")} />
          <Handle pos="bottom" onDown={onMouseDown("bottom")} />
        </div>
        {/* linha de centro vertical */}
        <div
          onMouseDown={onMouseDown("cx")}
          style={{
            position: "absolute",
            left: center.x - 1,
            top: tl.y,
            width: 2,
            height: br.y - tl.y,
            background: "rgba(56,189,248,0.85)",
            cursor: "ew-resize",
          }}
          title="Centro horizontal"
        />
        {/* linha do pé horizontal */}
        <div
          onMouseDown={onMouseDown("foot")}
          style={{
            position: "absolute",
            left: tl.x,
            top: foot.y - 1,
            width: br.x - tl.x,
            height: 2,
            background: "rgba(251,191,36,0.85)",
            cursor: "ns-resize",
          }}
          title="Linha do pé (baseline)"
        />
      </div>
      <div className="space-y-2 text-xs">
        <div className="font-medium text-sm">
          {frame.facing.toUpperCase()} — frame {frame.col}{" "}
          <span className="text-muted-foreground font-normal">(#{index})</span>
        </div>
        <div className="grid grid-cols-2 gap-2 text-[11px]">
          <Num label="x0" v={frame.x0} onChange={(v) => onChange({ x0: v })} />
          <Num label="x1" v={frame.x1} onChange={(v) => onChange({ x1: v })} />
          <Num label="y0" v={frame.y0} onChange={(v) => onChange({ y0: v })} />
          <Num label="y1" v={frame.y1} onChange={(v) => onChange({ y1: v })} />
          <Num label="centro X" v={frame.cx} onChange={(v) => onChange({ cx: v })} />
          <Num label="pé Y" v={frame.footY} onChange={(v) => onChange({ footY: v })} />
        </div>
        <div className="flex gap-2 pt-2">
          <button
            type="button"
            onClick={onResetAuto}
            className="px-2 py-1 rounded bg-muted text-xs hover:bg-muted/70"
          >
            Refazer auto
          </button>
          <button
            type="button"
            onClick={() => onChange({ empty: !frame.empty })}
            className="px-2 py-1 rounded bg-muted text-xs hover:bg-muted/70"
          >
            {frame.empty ? "Marcar como usado" : "Marcar vazio"}
          </button>
        </div>
        <p className="text-[10px] text-muted-foreground pt-2">
          Azul = centro horizontal (alinhamento entre frames). Amarelo = linha do pé (baseline).
        </p>
      </div>
    </div>
  );
}

function Handle({
  pos,
  onDown,
}: {
  pos: "left" | "right" | "top" | "bottom";
  onDown: (e: React.MouseEvent) => void;
}) {
  const map: Record<typeof pos, React.CSSProperties> = {
    left: { left: -4, top: "50%", marginTop: -4, cursor: "ew-resize" },
    right: { right: -4, top: "50%", marginTop: -4, cursor: "ew-resize" },
    top: { top: -4, left: "50%", marginLeft: -4, cursor: "ns-resize" },
    bottom: { bottom: -4, left: "50%", marginLeft: -4, cursor: "ns-resize" },
  };
  return (
    <div
      onMouseDown={onDown}
      style={{
        position: "absolute",
        width: 8,
        height: 8,
        background: "hsl(var(--primary))",
        ...map[pos],
      }}
    />
  );
}

function Num({
  label,
  v,
  onChange,
}: {
  label: string;
  v: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex items-center gap-1.5">
      <span className="text-muted-foreground w-14">{label}</span>
      <input
        type="number"
        value={Math.round(v)}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 rounded border bg-background px-1.5 py-0.5 text-[11px] font-mono w-0 min-w-0"
      />
    </label>
  );
}
