// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { MeetingStage, type StageControls } from "./MeetingStage";

afterEach(cleanup);
class RO { observe() {} disconnect() {} }
(globalThis as any).ResizeObserver = RO;

/** Simula o estado único do Office (rtc): a Meeting View só lê e chama os mesmos handlers. */
function Harness({ spy, mode = "meeting", withScreen = false }: { spy: Record<string, any>; mode?: "meeting" | "presentation"; withScreen?: boolean }) {
  const [mic, setMic] = useState(false);
  const [cam, setCam] = useState(false);
  const [scr, setScr] = useState(false);
  const [stage, setStage] = useState(true);
  const controls: StageControls = {
    micOn: mic, camOn: cam, screenOn: scr, canShare: true, handUp: false,
    onToggleMic: () => { spy.mic(); setMic((v) => !v); },
    onToggleCam: () => { spy.cam(); setCam((v) => !v); },
    onToggleScreen: () => { spy.screen(); setScr((v) => !v); },
    onToggleHand: spy.hand,
  };
  const screens = withScreen ? [{ key: "r", label: "Tela de Ana", stream: {} as MediaStream, isLocal: false }] : [];
  return (
    <>
      <span data-testid="office-mic">{mic ? "on" : "off"}</span>
      <span data-testid="office-cam">{cam ? "on" : "off"}</span>
      <button onClick={() => setCam((v) => !v)}>office-cam-toggle</button>
      <button onClick={() => setStage((v) => !v)}>stage-toggle</button>
      {stage && <MeetingStage mode={mode} participants={[]} screens={screens} raisedHands={{}} onStopLocalShare={() => {}} onViewOffice={() => {}} controls={controls} />}
    </>
  );
}
const spies = () => ({ mic: vi.fn(), cam: vi.fn(), screen: vi.fn(), hand: vi.fn() });

it("mic/câmera: Meeting View reflete e altera o mesmo estado do Office", () => {
  const spy = spies();
  render(<Harness spy={spy} />);
  expect(screen.getByLabelText("Ligar microfone")).toBeTruthy();
  fireEvent.click(screen.getByLabelText("Ligar microfone"));
  expect(screen.getByTestId("office-mic").textContent).toBe("on");
  fireEvent.click(screen.getByLabelText("Desligar microfone"));
  expect(screen.getByTestId("office-mic").textContent).toBe("off");
  fireEvent.click(screen.getByLabelText("Ligar câmera"));
  expect(screen.getByTestId("office-cam").textContent).toBe("on");
  fireEvent.click(screen.getByLabelText("Desligar câmera"));
  expect(spy.mic).toHaveBeenCalledTimes(2);
  expect(spy.cam).toHaveBeenCalledTimes(2);
});

it("câmera ligada no Office aparece ligada ao abrir a Meeting View; sair preserva estado", () => {
  render(<Harness spy={spies()} />);
  fireEvent.click(screen.getByText("stage-toggle"));
  fireEvent.click(screen.getByText("office-cam-toggle"));
  fireEvent.click(screen.getByText("stage-toggle"));
  expect(screen.getByLabelText("Desligar câmera")).toBeTruthy();
  fireEvent.click(screen.getByText("stage-toggle"));
  expect(screen.getByTestId("office-cam").textContent).toBe("on");
});

it("controles visíveis em apresentação própria e ao assistir; share usa o handler existente", () => {
  const spy = spies();
  const { unmount } = render(<Harness spy={spy} mode="presentation" withScreen />);
  expect(screen.getByTestId("meeting-controls")).toBeTruthy();
  fireEvent.click(screen.getByLabelText("Compartilhar tela"));
  expect(spy.screen).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText("Parar compartilhamento", { selector: "[data-testid=meeting-controls] button" })).toBeTruthy();
  unmount();
});

it("não cria tracks: nenhum getUserMedia/getDisplayMedia é chamado pela barra", () => {
  const gum = vi.fn(); const gdm = vi.fn();
  Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia: gum, getDisplayMedia: gdm }, configurable: true });
  render(<Harness spy={spies()} />);
  fireEvent.click(screen.getByLabelText("Ligar microfone"));
  fireEvent.click(screen.getByLabelText("Ligar câmera"));
  fireEvent.click(screen.getByLabelText("Compartilhar tela"));
  expect(gum).not.toHaveBeenCalled();
  expect(gdm).not.toHaveBeenCalled();
});
