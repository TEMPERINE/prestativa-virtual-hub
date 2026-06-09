import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { adminGenerateWalkFrame } from "@/lib/admin/ai-sprite.functions";
import { Loader2, Wand2, RefreshCw } from "lucide-react";
import { toast } from "sonner";

type Facing = "down" | "up" | "left" | "right";
const FACINGS: Facing[] = ["down", "up", "left", "right"];
const FACING_LABEL: Record<Facing, string> = {
  down: "Frente",
  up: "Costas",
  left: "Esquerda",
  right: "Direita",
};

type FrameImg = { dataUrl: string; isAi: boolean };
type FacingFrames = (FrameImg | null)[]; // length 6

type Props = {
  /** Chamado quando todas as 4 facings tiverem 6 frames prontos.
   *  Devolve um File PNG 4×6 que pode ser entregue ao SkinSheetEditor. */
  onSheetReady: (file: File) => void;
};

const CELL_W = 256;
const CELL_H = 384;

async function fileToDataUrl(f: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = reject;
    r.readAsDataURL(f);
  });
}

async function loadImg(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = dataUrl;
  });
}

export function AiWalkComposer({ onSheetReady }: Props) {
  const genFn = useServerFn(adminGenerateWalkFrame);
  const [refs, setRefs] = useState<Record<Facing, string | null>>({
    down: null,
    up: null,
    left: null,
    right: null,
  });
  const [frames, setFrames] = useState<Record<Facing, FacingFrames>>({
    down: Array(6).fill(null),
    up: Array(6).fill(null),
    left: Array(6).fill(null),
    right: Array(6).fill(null),
  });
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [uploadMode, setUploadMode] = useState<"four" | "sheet">("four");

  const setRefAndFrame0 = (facing: Facing, url: string) => {
    setRefs((p) => ({ ...p, [facing]: url }));
    setFrames((p) => {
      const next = { ...p };
      const arr = [...next[facing]];
      arr[0] = { dataUrl: url, isAi: false };
      next[facing] = arr;
      return next;
    });
  };

  const onUpload = async (facing: Facing, f: File | null) => {
    if (!f) return;
    const url = await fileToDataUrl(f);
    setRefAndFrame0(facing, url);
  };

  /** Fatia 1 imagem em grade 2×2 → down (TL), up (TR), left (BL), right (BR). */
  const onUploadSheet = async (f: File | null) => {
    if (!f) return;
    try {
      const url = await fileToDataUrl(f);
      const img = await loadImg(url);
      const halfW = Math.floor(img.width / 2);
      const halfH = Math.floor(img.height / 2);
      const slice = (sx: number, sy: number): string => {
        const c = document.createElement("canvas");
        c.width = halfW;
        c.height = halfH;
        const ctx = c.getContext("2d")!;
        ctx.drawImage(img, sx, sy, halfW, halfH, 0, 0, halfW, halfH);
        return c.toDataURL("image/png");
      };
      const tiles: Record<Facing, string> = {
        down: slice(0, 0),
        up: slice(halfW, 0),
        left: slice(0, halfH),
        right: slice(halfW, halfH),
      };
      for (const fac of FACINGS) setRefAndFrame0(fac, tiles[fac]);
      toast.success("Folha fatiada nas 4 poses.");
    } catch (e: any) {
      toast.error(e?.message ?? "Erro ao fatiar a imagem");
    }
  };

  /** Gera frames 1..5 de uma facing. Mapeamento:
   *  frame 0 = idle (upload)
   *  frame 1 = step esquerdo (walkIndex 0)
   *  frame 2 = mid (walkIndex 1)
   *  frame 3 = step direito (walkIndex 2)
   *  frame 4 = mid (walkIndex 1, reuso)
   *  frame 5 = step esquerdo (walkIndex 0, reuso) — fecha o ciclo
   */
  const generateFacing = async (facing: Facing, ref: string) => {
    const slots: { frame: number; walk: 0 | 1 | 2 }[] = [
      { frame: 1, walk: 0 },
      { frame: 2, walk: 1 },
      { frame: 3, walk: 2 },
    ];
    for (const { frame, walk } of slots) {
      const { b64 } = (await genFn({
        data: { refImageBase64: ref, facing, walkIndex: walk },
      })) as { b64: string };
      const dataUrl = `data:image/png;base64,${b64}`;
      setFrames((p) => {
        const next = { ...p };
        const arr = [...next[facing]];
        arr[frame] = { dataUrl, isAi: true };
        next[facing] = arr;
        return next;
      });
      setProgress((p) => (p ? { ...p, done: p.done + 1 } : null));
    }
    // reuso: 4 ← 2, 5 ← 1
    setFrames((p) => {
      const next = { ...p };
      const arr = [...next[facing]];
      if (arr[2]) arr[4] = arr[2];
      if (arr[1]) arr[5] = arr[1];
      next[facing] = arr;
      return next;
    });
  };

  const generateAll = async () => {
    const missing = FACINGS.filter((f) => !refs[f]);
    if (missing.length) {
      toast.error(`Falta enviar: ${missing.map((m) => FACING_LABEL[m]).join(", ")}`);
      return;
    }
    setBusy(true);
    setProgress({ done: 0, total: FACINGS.length * 3 });
    try {
      for (const f of FACINGS) await generateFacing(f, refs[f]!);
      toast.success("Frames gerados!");
    } catch (e: any) {
      toast.error(e?.message ?? "Erro ao gerar");
    }
    setBusy(false);
    setProgress(null);
  };

  const regenerateFrame = async (facing: Facing, frameIdx: number) => {
    const ref = refs[facing];
    if (!ref) return;
    const walkMap: Record<number, 0 | 1 | 2 | null> = {
      1: 0,
      2: 1,
      3: 2,
      4: 1,
      5: 0,
    };
    const walk = walkMap[frameIdx];
    if (walk === undefined || walk === null) {
      toast.error("Frame 0 é a imagem de referência (re-envie pra trocar).");
      return;
    }
    setBusy(true);
    try {
      const { b64 } = (await genFn({
        data: { refImageBase64: ref, facing, walkIndex: walk },
      })) as { b64: string };
      setFrames((p) => {
        const next = { ...p };
        const arr = [...next[facing]];
        arr[frameIdx] = { dataUrl: `data:image/png;base64,${b64}`, isAi: true };
        next[facing] = arr;
        return next;
      });
    } catch (e: any) {
      toast.error(e?.message ?? "Erro");
    }
    setBusy(false);
  };

  const composeAndContinue = async () => {
    // Verifica completude
    for (const f of FACINGS) {
      for (let i = 0; i < 6; i++) {
        if (!frames[f][i]) {
          toast.error(`Falta o frame ${i} de ${FACING_LABEL[f]}`);
          return;
        }
      }
    }
    setBusy(true);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = CELL_W * 6;
      canvas.height = CELL_H * 4;
      const ctx = canvas.getContext("2d")!;
      // fundo branco — o sheet-processor remove via flood fill
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      for (let r = 0; r < 4; r++) {
        const facing = FACINGS[r];
        for (let c = 0; c < 6; c++) {
          const img = await loadImg(frames[facing][c]!.dataUrl);
          // contain dentro da célula
          const cellX = c * CELL_W,
            cellY = r * CELL_H;
          const scale = Math.min(CELL_W / img.width, CELL_H / img.height);
          const dw = img.width * scale,
            dh = img.height * scale;
          const dx = cellX + (CELL_W - dw) / 2;
          const dy = cellY + (CELL_H - dh); // alinha embaixo
          ctx.drawImage(img, dx, dy, dw, dh);
        }
      }
      const blob: Blob = await new Promise((resolve, reject) =>
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob"))), "image/png"),
      );
      const file = new File([blob], "ai-sheet.png", { type: "image/png" });
      onSheetReady(file);
      toast.success("Folha composta — ajuste os recortes abaixo.");
    } catch (e: any) {
      toast.error(e?.message ?? "Erro ao compor");
    }
    setBusy(false);
  };

  return (
    <div className="space-y-4 p-4 rounded-xl border border-border bg-muted/10">
      <div className="flex items-start gap-2 text-[11px] text-muted-foreground">
        <Wand2 size={14} className="text-primary shrink-0 mt-0.5" />
        <p>
          Envie 1 imagem por direção. A IA gera os 5 frames de caminhada de cada uma
          (12 gerações no total). Você pode regenerar frames individuais que ficarem ruins
          antes de prosseguir para o editor de recorte.
        </p>
      </div>

      {/* Seletor de modo de upload */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setUploadMode("four")}
          className={`px-3 py-1.5 rounded-lg text-[11px] font-medium ${uploadMode === "four" ? "bg-foreground text-background" : "bg-muted text-foreground"}`}
        >
          4 imagens separadas
        </button>
        <button
          type="button"
          onClick={() => setUploadMode("sheet")}
          className={`px-3 py-1.5 rounded-lg text-[11px] font-medium ${uploadMode === "sheet" ? "bg-foreground text-background" : "bg-muted text-foreground"}`}
        >
          1 folha 2×2 (auto-fatiar)
        </button>
      </div>

      {uploadMode === "sheet" && (
        <div className="p-3 rounded-lg border border-dashed border-border bg-background/50">
          <label className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
            Folha 2×2 (frente / costas em cima — esquerda / direita embaixo)
          </label>
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(e) => onUploadSheet(e.target.files?.[0] ?? null)}
            className="w-full text-[11px]"
          />
          <p className="text-[10px] text-muted-foreground mt-1.5">
            A imagem é dividida em 4 quadrantes iguais e cada um vira a referência de uma direção.
          </p>
        </div>
      )}

      {/* Slots de upload / preview */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {FACINGS.map((f) => (
          <div key={f} className="space-y-1.5">
            <label className="block text-[10px] uppercase tracking-wider text-muted-foreground">
              {FACING_LABEL[f]}
            </label>
            <div className="relative aspect-[2/3] rounded-lg border border-dashed border-border bg-background overflow-hidden">
              {refs[f] ? (
                <img src={refs[f]!} alt="" className="w-full h-full object-contain" />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center text-[10px] text-muted-foreground">
                  Sem imagem
                </div>
              )}
            </div>
            {uploadMode === "four" && (
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(e) => onUpload(f, e.target.files?.[0] ?? null)}
                className="w-full text-[10px]"
              />
            )}

      <button
        type="button"
        onClick={generateAll}
        disabled={busy}
        className="px-4 py-2 rounded-lg gradient-primary text-primary-foreground text-sm font-medium inline-flex items-center gap-2 disabled:opacity-50"
      >
        {busy ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
        {progress
          ? `Gerando ${progress.done}/${progress.total}…`
          : "Gerar frames de caminhada"}
      </button>

      {/* Grid de frames */}
      <div className="space-y-2">
        {FACINGS.map((f) => (
          <div key={f} className="flex items-center gap-2">
            <div className="w-16 text-[10px] uppercase tracking-wider text-muted-foreground">
              {FACING_LABEL[f]}
            </div>
            <div className="flex gap-1.5">
              {frames[f].map((fr, i) => (
                <div key={i} className="relative group">
                  <div className="w-14 h-20 rounded border border-border bg-background overflow-hidden flex items-center justify-center">
                    {fr ? (
                      <img src={fr.dataUrl} alt="" className="w-full h-full object-contain" />
                    ) : (
                      <span className="text-[9px] text-muted-foreground">{i}</span>
                    )}
                  </div>
                  {fr?.isAi && i !== 0 && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => regenerateFrame(f, i)}
                      title="Regerar este frame"
                      className="absolute top-0.5 right-0.5 p-0.5 rounded bg-black/60 text-white opacity-0 group-hover:opacity-100 disabled:opacity-50"
                    >
                      <RefreshCw size={10} />
                    </button>
                  )}
                  <div className="absolute bottom-0.5 left-0.5 text-[8px] bg-black/60 text-white px-1 rounded">
                    {i}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={composeAndContinue}
        disabled={busy}
        className="px-4 py-2 rounded-lg bg-foreground text-background text-sm font-medium disabled:opacity-50"
      >
        Compor folha e abrir editor de recorte →
      </button>
    </div>
  );
}
