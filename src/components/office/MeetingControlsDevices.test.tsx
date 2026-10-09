// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { MeetingStage, type StageControls, type StageParticipant } from "./MeetingStage";

afterEach(cleanup);
class RO { observe() {} disconnect() {} }
(globalThis as any).ResizeObserver = RO;
Object.defineProperty(HTMLElement.prototype, "clientWidth", { get: () => 1200, configurable: true });
Object.defineProperty(HTMLElement.prototype, "clientHeight", { get: () => 800, configurable: true });
Object.defineProperty(HTMLMediaElement.prototype, "play", { value: () => Promise.resolve(), configurable: true });
Object.defineProperty(HTMLMediaElement.prototype, "srcObject", { value: null, writable: true, configurable: true });

const dev = (id: string, kind: MediaDeviceKind, label: string) => ({ deviceId: id, kind, label, groupId: "" }) as MediaDeviceInfo;
const mics = [dev("m1", "audioinput", "Mic interno"), dev("m2", "audioinput", "Headset USB")];
const cams = [dev("c1", "videoinput", "Webcam integrada"), dev("c2", "videoinput", "Webcam Logitech")];
const part = (id: string, name: string): StageParticipant => ({ id, profile: { id, display_name: name, avatar_color: "" }, stream: null, hasVideo: false, micOn: true, speaking: false });

/** Office simulado: um único estado; Meeting View só lê e chama os mesmos handlers. */
function Harness({ gum }: { gum: () => void }) {
  const [mic, setMic] = useState(false);
  const [micId, setMicId] = useState("m1");
  const [camId, setCamId] = useState("c1");
  const [hands, setHands] = useState<Record<string, boolean>>({ other: true });
  const c: StageControls = {
    micOn: mic, camOn: false, screenOn: false, canShare: true, handUp: !!hands.me,
    onToggleMic: () => setMic((v) => !v), onToggleCam: () => {}, onToggleScreen: () => {},
    onToggleHand: () => setHands((h) => ({ ...h, me: !h.me })),
    micTrack: mic ? {} : null,
    audioInputs: mics, selectedAudioInputId: micId, onSelectAudioInput: (id) => { gum(); setMicId(id); },
    videoInputs: cams, selectedVideoId: camId, onSelectVideo: setCamId,
  };
  return (
    <>
      <span data-testid="office-mic-id">{micId}</span>
      <span data-testid="office-cam-id">{camId}</span>
      <button onClick={() => setCamId("c2")}>office-pick-cam</button>
      <MeetingStage mode="meeting" participants={[part("me", "Eu"), part("other", "Ana")]} screens={[]} raisedHands={hands} onStopLocalShare={() => {}} onViewOffice={() => {}} controls={c} />
    </>
  );
}

it("microfone: VU só com mic ON, menu lista e troca pelo handler do Office", () => {
  const sel = vi.fn();
  render(<Harness gum={sel} />);
  expect(screen.queryByLabelText(/Nível do microfone|Microfone desligado/)).toBeNull();
  fireEvent.click(screen.getByLabelText("Ligar microfone"));
  expect(screen.getByLabelText(/Nível do microfone/)).toBeTruthy();
  fireEvent.click(screen.getByLabelText("Selecionar microfone"));
  expect(screen.getByText("Headset USB")).toBeTruthy();
  fireEvent.click(screen.getByText("Headset USB"));
  expect(sel).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId("office-mic-id").textContent).toBe("m2");
});

it("câmera: troca pela Meeting View e reflete troca feita no Office", () => {
  render(<Harness gum={() => {}} />);
  fireEvent.click(screen.getByLabelText("Selecionar câmera"));
  fireEvent.click(screen.getByText("Webcam Logitech"));
  expect(screen.getByTestId("office-cam-id").textContent).toBe("c2");
  fireEvent.click(screen.getByLabelText("Selecionar câmera"));
  expect(screen.getByRole("menuitemradio", { name: "Webcam Logitech" }).getAttribute("aria-checked")).toBe("true");
});

it("mão: toggle levantar/baixar, badge por card e múltiplas mãos", () => {
  render(<Harness gum={() => {}} />);
  expect(screen.getAllByTestId("hand-badge").length).toBe(1);
  fireEvent.click(screen.getByLabelText("Levantar a mão"));
  const b = screen.getByLabelText("Baixar a mão");
  expect(b.getAttribute("aria-pressed")).toBe("true");
  expect(b.getAttribute("title")).toMatch(/Baixar a mão/);
  expect(screen.getAllByTestId("hand-badge").length).toBe(2);
  fireEvent.click(b);
  expect(screen.getByLabelText("Levantar a mão")).toBeTruthy();
  expect(screen.getAllByTestId("hand-badge").length).toBe(1);
});

it("menus ficam dentro da camada global (acima do share) e não pedem mídia", () => {
  const gum = vi.fn(); const gdm = vi.fn();
  Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia: gum, getDisplayMedia: gdm }, configurable: true });
  render(<Harness gum={() => {}} />);
  fireEvent.click(screen.getByLabelText("Selecionar microfone"));
  const menu = screen.getByRole("menu", { name: "Selecionar microfone" });
  expect(screen.getByTestId("global-meeting-controls").contains(menu)).toBe(true);
  expect(gum).not.toHaveBeenCalled();
  expect(gdm).not.toHaveBeenCalled();
});
