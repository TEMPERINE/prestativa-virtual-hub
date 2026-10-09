import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

describe("Embedded meeting portal layers", () => {
  it("raises menus and both dialog layers only while the Office panel exists", () => {
    const css = read("src/styles.css");
    expect(css).toMatch(/:root\s*\{\s*--layer-dialog-backdrop: 50;\s*--layer-dialog-content: 50;\s*--layer-dropdown: 50;/);
    expect(css).toMatch(/body:has\(\[data-office-meetings-panel\]\)\s*\{\s*--layer-dropdown: 330;\s*--layer-dialog-backdrop: 360;\s*--layer-dialog-content: 361;/);
    expect(read("src/routes/_authenticated/workspaces.$workspaceId.tsx")).toMatch(/data-office-meetings-panel className="fixed inset-0 z-\[300\]/);
  });

  it("uses the tokens for sending, deletion, folder prompts and folder menus", () => {
    for (const component of ["dialog", "alert-dialog"]) {
      const source = read(`src/components/ui/${component}.tsx`);
      expect(source).toContain("inset-0 z-[var(--layer-dialog-backdrop)]");
      expect(source).toContain("top-[50%] z-[var(--layer-dialog-content)]");
    }
    expect(read("src/components/ui/dropdown-menu.tsx").match(/z-\[var\(--layer-dropdown\)\]/g)).toHaveLength(2);
  });
});