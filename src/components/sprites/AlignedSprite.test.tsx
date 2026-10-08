// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AlignedSprite, spriteFramePlacement } from "./AlignedSprite";

vi.mock("@/lib/sprite-alignment", () => ({
  ensureFrameOffsets: vi.fn().mockResolvedValue([]),
  getFrameOffsets: () => Array.from({ length: 6 }, () => ({ dx: 0.1, dy: 0.05 })),
  subscribeFrameOffsets: () => () => {},
}));
afterEach(cleanup);

describe("exact atlas placement", () => {
  it.each([0, 1, 2, 3, 4, 5])("selects cell %i regardless of offsets or mirroring", (frame) => {
    for (const mirror of [false, true]) {
      expect(spriteFramePlacement(frame, 0.123, -0.04, mirror).backgroundPosition).toBe(`${frame * 20}% 100%`);
      expect(spriteFramePlacement(frame, -0.2, 0.08, mirror).backgroundPosition).toBe(`${frame * 20}% 100%`);
    }
  });
  it("moves alignment after selection, preserving mirror sign and fractional offsets", () => {
    expect(spriteFramePlacement(2, 0.125, 0.025, false).transform).toBe("translate(calc(-50% + -12.5%), -2.5%)");
    expect(spriteFramePlacement(2, 0.125, 0.025, true).transform).toBe("translate(calc(-50% + 12.5%), -2.5%) scaleX(-1)");
  });
});

it.each(["marcio", "karen", "indi", "bia", "wily"])("keeps %s texture unfiltered and shadow independent", (spriteId) => {
  const { container } = render(<AlignedSprite spriteId={spriteId} facing="down" frame={2} mode="scene" />);
  const layers = container.querySelectorAll<HTMLElement>("[data-sprite-facing]");
  expect(layers.length).toBe(4);
  for (const layer of layers) {
    expect(layer.style.filter).toBe("");
    expect(layer.style.backgroundSize).toBe("600% 100%");
    expect(layer.style.backgroundPosition).toBe("40% 100%");
    expect(layer.style.imageRendering).toBe("auto");
  }
  const shadow = container.querySelector<HTMLElement>("[data-sprite-shadow]");
  expect(shadow?.style.backgroundImage).not.toContain("url(");
  expect(shadow?.parentElement).toBe(layers[0]?.parentElement);
  expect(shadow?.style.filter).toBe("blur(1.5px)");
});

it("preserves the lateral idle replacement and preview size", () => {
  const { container } = render(<AlignedSprite spriteId="indi" facing="right" frame={3} size={96} />);
  const layer = container.querySelector<HTMLElement>("[data-sprite-facing]");
  expect(layer?.dataset.spriteFrame).toBe("0");
  expect(layer?.style.transform).toContain("scaleX(-1)");
  expect(container.firstElementChild?.getAttribute("style")).toContain("width: 96px");
});