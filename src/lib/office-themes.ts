// Temas visuais do escritório. Inicialmente alteram somente a imagem de
// fundo (BG) do mapa — sem mexer em proporções, colliders, zonas etc.
// A seleção é persistida dentro de map_overrides (escopado por workspace
// e sincronizado em nuvem), de forma que todos os usuários do mesmo
// espaço vejam o mesmo tema.

import officeMapDefault from "@/assets/office-map.webp";
import officeMapCopa from "@/assets/office-map-copa.jpg.asset.json";
import officeMapJunino from "@/assets/office-map-junino.jpg.asset.json";
import {
  loadOverrides,
  newOverrides,
  saveOverrides,
  pushOverridesToCloud,
} from "@/lib/map-overrides";

export type OfficeTheme = {
  id: string;
  label: string;
  description?: string;
  url: string;
};

export const OFFICE_THEMES: OfficeTheme[] = [
  {
    id: "default",
    label: "Padrão",
    description: "Layout original da Prestativa Office.",
    url: officeMapDefault,
  },
  {
    id: "rumo-ao-hexa",
    label: "Rumo ao Hexa",
    description: "Decoração temática verde e amarela para a Copa.",
    url: officeMapCopa.url,
  },
  {
    id: "festa-junina",
    label: "Festa Junina",
    description: "Bandeirinhas, girassóis e xadrez vermelho — arraiá no escritório.",
    url: officeMapJunino.url,
  },
];

export const DEFAULT_THEME_ID = "default";
export const CUSTOM_THEME_ID = "custom";
const EVENT = "office-theme-changed";

export function getCurrentThemeId(): string {
  return loadOverrides()?.theme ?? DEFAULT_THEME_ID;
}

export function getTheme(id: string): OfficeTheme {
  return OFFICE_THEMES.find((t) => t.id === id) ?? OFFICE_THEMES[0];
}

export function getCurrentTheme(): OfficeTheme {
  const o = loadOverrides();
  const id = o?.theme ?? DEFAULT_THEME_ID;
  if (id === CUSTOM_THEME_ID && o?.customTheme?.url) {
    return {
      id: CUSTOM_THEME_ID,
      label: o.customTheme.label || "Tema personalizado",
      description: "Tema enviado pelo administrador.",
      url: o.customTheme.url,
    };
  }
  return getTheme(id);
}

export async function setCurrentThemeId(id: string): Promise<{ ok: boolean; error?: string }> {
  const base = loadOverrides() ?? newOverrides();
  const next = { ...base, theme: id };
  saveOverrides(next);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(EVENT));
  }
  return pushOverridesToCloud(next);
}

export function subscribeTheme(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = () => cb();
  window.addEventListener(EVENT, handler);
  // map-overrides-changed cobre cargas iniciais da nuvem e edições remotas
  window.addEventListener("map-overrides-changed", handler);
  return () => {
    window.removeEventListener(EVENT, handler);
    window.removeEventListener("map-overrides-changed", handler);
  };
}
