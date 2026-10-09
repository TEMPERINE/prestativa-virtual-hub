// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { ScreenShareViewer } from "./ScreenShareViewer";
import { MeetingStage, type StageControls } from "./MeetingStage";
import { GLOBAL_MEETING_CONTROLS_Z } from "./GlobalMeetingControlsLayer";

afterEach(() => { cleanup(); Object.defineProperty(document, "fullscreenElement", { value: null, configurable: true }); });
(globalThis as any).ResizeObserver = class { observe() {} disconnect() {} };
Object.defineProperty(HTMLMediaElement.prototype, "play", { value: () => Promise.resolve(), configurable: true });
Object.defineProperty(HTMLMediaElement.prototype, "srcObject", { value: null, writable: true, configurable: true });

const liveStream = () => ({ getVideoTracks: () => [{ readyState: "live", enabled: true }] }) as unknown as MediaStream;
const remote = liveStream();
const profiles = { ana: { id: "ana", display_name: "Ana", avatar_color: "#333" } };
const participants = [{ id: "ana", profile: profiles.ana, stream: null, hasVideo: false, micOn: true, speaking: false }];

/** Estado único do Office: a camada global só lê e chama os mesmos handlers. */
function Office({ spy, own = false, stage = false }: { spy: Record<string, any>; own?: boolean; stage?: boolean }) {
  const [mic, setMic] = useState(false);
  const [cam, setCam] = useState(false);
  const [scr, setScr] = useState(own);
  const controls: StageControls = {
    micOn: mic, camOn: cam, screenOn: scr, canShare: true, handUp: false,
    onToggleMic: () => { spy.mic(); setMic((v) => !v); },
    onToggleCam: () => { spy.cam(); setCam((v) => !v); },
    onToggleScreen: () => { spy.screen(); setScr((v) => !v); },
    onToggleHand: spy.hand,
  };
  return (
    <>
      <span data-testid="mic">{mic ? "on" : "off"}</span>
      <span data-testid="cam">{cam ? "on" : "off"}</span>
      {stage ? (
        <MeetingStage mode="presentation" participants={[]} raisedHands={{}} onStopLocalShare={() => setScr(false)} onViewOffice={() => {}} controls={controls}
          screens={[{ key: "r", label: "Tela de Ana", stream: remote, isLocal: false }]} />
      ) : (
        <ScreenShareViewer localStream={scr ? liveStream() : null} remoteStreams={own ? {} : { ana: remote }} profiles={profiles}
          onStopLocal={() => setScr(false)} participants={participants} controls={controls} />
      )}
    </>
  );
}
const spies = () => ({ mic: vi.fn(), cam: vi.fn(), screen: vi.fn(), hand: vi.fn() });
const layer = () => screen.getByTestId("global-meeting-controls");

it("assistindo share de outra pessoa: barra global acima do share e dos cards", () => {
  render(<Office spy={spies()} />);
  const l = layer();
  expect(Number(l.style.zIndex)).toBe(GLOBAL_MEETING_CONTROLS_Z);
  expect(GLOBAL_MEETING_CONTROLS_Z).toBeGreaterThan(2147483600);
  expect(l.className).toContain("pointer-events-none");
  expect((screen.getByTestId("meeting-controls").parentElement as HTMLElement).className).toContain("pointer-events-auto");
});

it("mic/câmera durante share alteram o mesmo estado do Office", () => {
  const spy = spies();
  render(<Office spy={spy} />);
  fireEvent.click(screen.getByLabelText("Ligar microfone"));
  fireEvent.click(screen.getByLabelText("Ligar câmera"));
  expect(screen.getByTestId("mic").textContent).toBe("on");
  expect(screen.getByTestId("cam").textContent).toBe("on");
  fireEvent.click(screen.getByLabelText("Desligar microfone"));
  expect(screen.getByTestId("mic").textContent).toBe("off");
});

it("share próprio: parar pela barra usa o handler existente e remove a camada", () => {
  const spy = spies();
  render(<Office spy={spy} own />);
  fireEvent.click(screen.getByLabelText("Parar compartilhamento", { selector: "[data-testid=meeting-controls] button" }));
  expect(spy.screen).toHaveBeenCalledTimes(1);
  expect(screen.queryByTestId("global-meeting-controls")).toBeNull();
});

it("fullscreen: barra montada dentro do elemento em tela cheia e volta ao body ao sair", () => {
  const fs = document.createElement("div"); document.body.appendChild(fs);
  render(<Office spy={spies()} />);
  act(() => { Object.defineProperty(document, "fullscreenElement", { value: fs, configurable: true }); document.dispatchEvent(new Event("fullscreenchange")); });
  expect(fs.contains(layer())).toBe(true);
  act(() => { Object.defineProperty(document, "fullscreenElement", { value: null, configurable: true }); document.dispatchEvent(new Event("fullscreenchange")); });
  expect(layer().parentElement).toBe(document.body);
  fs.remove();
});

it("palco V2 usa a mesma camada global, sem barra duplicada", () => {
  render(<Office spy={spies()} stage />);
  expect(screen.getAllByTestId("meeting-controls")).toHaveLength(1);
  expect(layer()).toBeTruthy();
});

it("nenhuma nova track: barra não chama getUserMedia/getDisplayMedia", () => {
  const gum = vi.fn(); const gdm = vi.fn();
  Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia: gum, getDisplayMedia: gdm }, configurable: true });
  render(<Office spy={spies()} />);
  fireEvent.click(screen.getByLabelText("Ligar microfone"));
  fireEvent.click(screen.getByLabelText("Ligar câmera"));
  fireEvent.click(screen.getByLabelText("Compartilhar tela"));
  expect(gum).not.toHaveBeenCalled();
  expect(gdm).not.toHaveBeenCalled();
});
