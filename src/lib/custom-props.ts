// Persistência e helpers para os elementos personalizados (galeria do editor).
// Os frames são guardados como data URLs (base64 PNG) na coluna `frames` (jsonb).
// Isso evita depender de bucket público de storage.

import { supabase } from "@/integrations/supabase/client";
import { setCustomProps, type PropDef } from "./prop-catalog";

type Row = {
  id: string;
  label: string;
  frames: string[];
  default_w: number;
  aspect_ratio: number;
};

export async function loadCustomPropsFromCloud(): Promise<void> {
  const { data, error } = await supabase
    .from("custom_props")
    .select("id,label,frames,default_w,aspect_ratio")
    .order("created_at", { ascending: true });
  if (error) {
    console.warn("[custom-props] load falhou", error);
    return;
  }
  const defs: PropDef[] = (data ?? []).map((r: Row) => ({
    id: r.id,
    label: r.label,
    frames: (r.frames as unknown as string[]) ?? [],
    defaultW: r.default_w ?? 0.08,
    aspectRatio: r.aspect_ratio ?? 1,
    interactive: ((r.frames as unknown as string[]) ?? []).length > 1,
    interactKey: "x",
    custom: true,
  }));
  setCustomProps(defs);
}

export async function deleteCustomProp(id: string): Promise<void> {
  const { error } = await supabase.from("custom_props").delete().eq("id", id);
  if (error) throw error;
  await loadCustomPropsFromCloud();
}

/** Lê o arquivo como HTMLImageElement. */
function readImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(e);
    };
    img.src = url;
  });
}

/** Recorta a imagem em N frames horizontais e devolve PNG data URLs. */
function splitFrames(img: HTMLImageElement, frameCount: number): string[] {
  const fw = Math.floor(img.naturalWidth / frameCount);
  const fh = img.naturalHeight;
  const out: string[] = [];
  for (let i = 0; i < frameCount; i++) {
    const canvas = document.createElement("canvas");
    canvas.width = fw;
    canvas.height = fh;
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, i * fw, 0, fw, fh, 0, 0, fw, fh);
    out.push(canvas.toDataURL("image/png"));
  }
  return out;
}

export type UploadOptions = {
  label: string;
  file: File;
  frameCount: number; // 1 = imagem única; >1 = sprite sheet horizontal
};

export async function uploadCustomProp(opts: UploadOptions): Promise<void> {
  const { label, file, frameCount } = opts;
  if (!label.trim()) throw new Error("Informe um nome para o elemento.");
  if (frameCount < 1) throw new Error("Quantidade de frames inválida.");

  const img = await readImage(file);
  if (img.naturalWidth % frameCount !== 0) {
    console.warn("[custom-props] largura não divisível pelo nº de frames; frames podem ficar levemente cortados.");
  }
  const frames = splitFrames(img, frameCount);

  const fw = Math.floor(img.naturalWidth / frameCount);
  const fh = img.naturalHeight;
  const aspectRatio = fw / fh;
  // largura padrão proporcional: assume ~80px de referência sobre largura típica do mapa.
  const defaultW = Math.min(0.25, Math.max(0.04, fw / 1200));

  const id = `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id ?? null;

  const { error } = await supabase.from("custom_props").insert({
    id,
    label: label.trim(),
    frames,
    default_w: defaultW,
    aspect_ratio: aspectRatio,
    created_by: userId,
  });
  if (error) throw error;
  await loadCustomPropsFromCloud();
}
