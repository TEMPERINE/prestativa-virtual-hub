// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { OfficeCelebrationPopup } from "./OfficeCelebrationPopup";

vi.mock("@/components/sprites/AlignedSprite", () => ({ AlignedSprite: ({ spriteId }: { spriteId: string }) => <span data-testid="sender-sprite">{spriteId}</span> }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals(); });
function setup(focus = true) {
  let focused = focus;
  vi.spyOn(document, "hasFocus").mockImplementation(() => focused);
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => window.setTimeout(() => fn(0), 1));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
  const close = vi.fn();
  render(<OfficeCelebrationPopup id="test" senderName="Dani" spriteId="dani" message="Parabéns pelo elogio, Fram!" onClose={close} />);
  return { close, focus: (value: boolean) => { focused = value; fireEvent(window, new Event(value ? "focus" : "blur")); } };
}
it("shows identical positive celebration copy, sender avatar and closes via X", () => {
  const { close } = setup();
  expect(screen.getByText("🎉 Dani tocou o sino")).toBeTruthy();
  expect(screen.getByText("Vamos comemorar!")).toBeTruthy();
  expect(screen.getByText("Parabéns pelo elogio, Fram!")).toBeTruthy();
  expect(screen.getByTestId("sender-sprite").textContent).toBe("dani");
  expect(screen.getByRole("dialog").closest("[data-office-toast-layer]")).toBeNull();
  fireEvent.click(screen.getByLabelText("Fechar comemoração"));
  expect(close).toHaveBeenCalledTimes(1);
});
it("does not render or consume display time in background, and pauses when focus is lost", () => {
  vi.useFakeTimers();
  const s = setup(false);
  expect(screen.queryByRole("dialog")).toBeNull();
  act(() => vi.advanceTimersByTime(60_000));
  expect(s.close).not.toHaveBeenCalled();
  s.focus(true);
  act(() => vi.advanceTimersByTime(4_001));
  s.focus(false);
  expect(screen.queryByRole("dialog")).toBeNull();
  act(() => vi.advanceTimersByTime(60_000));
  expect(s.close).not.toHaveBeenCalled();
  s.focus(true);
  act(() => vi.advanceTimersByTime(8_001));
  expect(s.close).toHaveBeenCalledTimes(1);
});
it("closes on the popup without blocking the background or trapping focus", () => {
  const s = setup();
  expect(screen.getByRole("dialog").getAttribute("aria-modal")).toBe("false");
  fireEvent.click(screen.getByText("Vamos comemorar!"));
  expect(s.close).toHaveBeenCalledTimes(1);
});