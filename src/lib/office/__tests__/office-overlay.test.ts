import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseOfficePanel, isMovementInputBlocked, OFFICE_PANELS } from "@/lib/office/overlay";

const read = (p: string) => readFileSync(p, "utf8");
const route = read("src/routes/_authenticated/workspaces.$workspaceId.tsx");
const scene = read("src/components/office/OfficeScene.tsx");
const menu = read("src/components/profile/ProfileMenu.tsx");
const overlay = read("src/lib/office/overlay.ts");

describe("Office Overlay Manager", () => {
  it("aceita só painéis conhecidos", () => {
    for (const p of OFFICE_PANELS) expect(parseOfficePanel(p)).toBe(p);
    expect(parseOfficePanel("x")).toBeUndefined();
    expect(parseOfficePanel(undefined)).toBeUndefined();
  });

  it("painel aberto bloqueia só input de movimento; fechado restaura", () => {
    expect(isMovementInputBlocked("meetings")).toBe(true);
    expect(isMovementInputBlocked(null)).toBe(false);
  });

  it("Minhas reuniões abre como painel no Office, sem navegar para /meetings", () => {
    expect(scene).toMatch(/onOpenMeetings=\{\(\) => onPanelChange\?\.\("meetings"\)\}/);
    expect(menu).toMatch(/p\.onOpenMeetings \?/);
  });

  it("OfficeScene fica montado: painel é irmão da cena, não troca de rota", () => {
    expect(route).toMatch(/<OfficeScene[\s\S]*panel=\{panel \?\? null\}/);
    expect(route).toMatch(/panel === "meetings" && \([\s\S]*<MeetingsPanel embedded/);
    expect(route).toMatch(/validateSearch/);
  });

  it("perfil, personagem e recadinhos vêm do ?panel=", () => {
    expect(scene).toMatch(/editCharOpen = panel === "character"/);
    expect(scene).toMatch(/editProfOpen = panel === "profile"/);
    expect(scene).toMatch(/savedNotesOpen = panel === "notes"/);
  });

  it("teclado de movimento ignorado com painel aberto", () => {
    expect(scene).toMatch(/const down = \(e: KeyboardEvent\) => \{\s*if \(isMovementInputBlocked\(panelRef\.current\)\) return;/);
  });

  it("fechar usa history.back (Back fecha painel antes de sair) e ESC fecha", () => {
    expect(route).toMatch(/window\.history\.back\(\)/);
    expect(route).toMatch(/e\.key !== "Escape"/);
  });

  it("overlay não importa RTC/Presence/sessão/reunião", () => {
    expect(overlay).not.toMatch(/import/);
  });

  it("/meetings direta continua usando o mesmo painel", () => {
    expect(read("src/routes/_authenticated/meetings.tsx")).toMatch(/<MeetingsPanel \/>/);
  });
});
