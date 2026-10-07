// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { createRef } from "react";
import { OfficeAreaNotice, OfficeNotice, OfficeToastLayer, useOfficeToastActive } from "./OfficeToastLayer";
import { OfficeCelebrationToast } from "./OfficeCelebrationToast";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("keeps standalone notice controls usable outside Office", () => {
  const click = vi.fn();
  render(<OfficeNotice><button onClick={click}>Action</button></OfficeNotice>);
  fireEvent.click(screen.getByText("Action"));
  expect(click).toHaveBeenCalledTimes(1);
});

it("uses positive pending copy and retains close action", () => {
  const close = vi.fn();
  render(<OfficeCelebrationToast id="a" senderName="Dani" message="Meta alcançada" missed onClose={close} />);
  expect(screen.getByText("🎉 Teve comemoração por aqui!")).toBeTruthy();
  expect(screen.getByText("Dani tocou o sino: Meta alcançada")).toBeTruthy();
  fireEvent.click(screen.getByLabelText("Fechar comemoração"));
  expect(close).toHaveBeenCalledTimes(1);
});

it("measures useful Office width and resets global toast geometry on unmount", () => {
  let resize: (() => void) | undefined;
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: () => void) { resize = callback; }
    observe() {} disconnect() {}
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    if (this.hasAttribute("data-office-team")) return { left: 800, right: 1088, bottom: 900 } as DOMRect;
    if (this.hasAttribute("data-office-topbar")) return { bottom: 44 } as DOMRect;
    return { left: 0, right: 1100, top: 0, height: this.hasAttribute("data-scene") ? 900 : 100 } as DOMRect;
  });
  function Status() { return <span>{useOfficeToastActive() ? "active" : "inactive"}</span>; }
  const sceneRef = createRef<HTMLDivElement>();
  const { unmount } = render(<OfficeToastLayer sceneRef={sceneRef} showTeam>
    <div ref={sceneRef} data-scene><div data-office-topbar /><div data-office-team /></div>
    <OfficeNotice><p>Notice</p></OfficeNotice><Status />
  </OfficeToastLayer>);
  act(() => resize?.());
  expect(screen.getByText("active")).toBeTruthy();
  expect(document.documentElement.style.getPropertyValue("--office-toast-center")).toBe("394px");
  expect(document.documentElement.style.getPropertyValue("--office-toast-width")).toBe("420px");
  expect(document.documentElement.style.getPropertyValue("--office-toast-top")).toBe("164px");
  expect(screen.getByText("Notice").closest("[data-office-toast-layer]")).toBeTruthy();
  unmount();
  expect(document.documentElement.style.getPropertyValue("--office-toast-center")).toBe("");
  vi.restoreAllMocks();
});

it("shows actions immediately, queues information and resumes it after dismissal", () => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  const sceneRef = createRef<HTMLDivElement>();
  const layout = (showAction: boolean) => <OfficeToastLayer sceneRef={sceneRef} showTeam={false}>
    <div ref={sceneRef} />
    <OfficeNotice kind="informational"><p>Info one</p></OfficeNotice>
    <OfficeNotice kind="informational"><p>Info two</p></OfficeNotice>
    <OfficeNotice kind="informational"><p>Info three</p></OfficeNotice>
    <OfficeNotice kind="celebration"><p>Celebration</p></OfficeNotice>
    {showAction && <OfficeNotice kind="action"><button>Accept invitation</button></OfficeNotice>}
  </OfficeToastLayer>;
  const { rerender } = render(layout(false));
  const visible = () => Array.from(document.querySelectorAll("[data-office-notice-kind]")).filter((element) => !element.hasAttribute("hidden"));
  expect(visible()).toHaveLength(3);
  expect(screen.getByText("Info three").closest("[hidden]")).toBeTruthy();
  rerender(layout(true));
  expect(visible()).toHaveLength(3);
  expect(screen.getByRole("button", { name: "Accept invitation" })).toBeTruthy();
  expect(visible().filter((element) => element.getAttribute("data-office-notice-kind") === "action")).toHaveLength(1);
  expect(screen.getByText("Info two").closest("[hidden]")).toBeTruthy();
  rerender(layout(false));
  expect(screen.getByText("Info two").closest("[hidden]")).toBeNull();
});

it("replaces rapid area feedback and hides it after a short interval", () => {
  vi.useFakeTimers();
  const { rerender } = render(<OfficeAreaNotice zoneId="first" label="Diretoria" />);
  act(() => { vi.advanceTimersByTime(1000); });
  rerender(<OfficeAreaNotice zoneId="second" label="Corredor" />);
  expect(screen.queryByText("Diretoria")).toBeNull();
  expect(screen.getByText("Corredor")).toBeTruthy();
  act(() => { vi.advanceTimersByTime(1800); });
  expect(screen.queryByText("Corredor")).toBeNull();
  vi.useRealTimers();
});