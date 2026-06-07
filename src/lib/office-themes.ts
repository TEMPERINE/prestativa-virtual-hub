// Temas visuais do escritório. Inicialmente alteram somente a imagem de
// fundo (BG) do mapa — sem mexer em proporções, colliders, zonas etc.
// A seleção é persistida em localStorage e escopada por workspace,
// para que cada espaço possa ter seu próprio tema.

import officeMapDefault from "@/assets/office-map.webp";
import officeMapCopa from "@/assets/office-map-copa.jpg.asset.json";
import { getCurrentWorkspaceId, subscribeCurrentWorkspaceId } from "@/lib/workspace/current";

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
];

export const DEFAULT_THEME_ID = "default";

function storageKey(ws: string | null): string {
  return ws ? `office-theme:${ws}` : "office-theme:_global";
}

const EVENT = "office-theme-changed";

export function getCurrentThemeId(): string {
  if (typeof window === "undefined") return DEFAULT_THEME_ID;
  try {
    return (
      window.localStorage.getItem(storageKey(getCurrentWorkspaceId())) ??
      DEFAULT_THEME_ID
    );
  } catch {
    return DEFAULT_THEME_ID;
  }
}

export function getTheme(id: string): OfficeTheme {
  return OFFICE_THEMES.find((t) => t.id === id) ?? OFFICE_THEMES[0];
}

export function getCurrentTheme(): OfficeTheme {
  return getTheme(getCurrentThemeId());
}

export function setCurrentThemeId(id: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(getCurrentWorkspaceId()), id);
  } catch {}
  window.dispatchEvent(new CustomEvent(EVENT));
}

export function subscribeTheme(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = () => cb();
  window.addEventListener(EVENT, handler);
  const unsubWs = subscribeCurrentWorkspaceId(() => cb());
  return () => {
    window.removeEventListener(EVENT, handler);
    unsubWs();
  };
}
