import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { canViewRecording } from "../recording-access";

const none = { isParticipant: false, isShareRecipient: false, isWorkspaceAdmin: false, isGlobalAdmin: false };

describe("acesso à gravação separado de CAN_RECORD", () => {
  it("participante operacional pode reproduzir", () => {
    expect(canViewRecording({ ...none, isParticipant: true })).toBe(true);
  });
  it("destinatário de compartilhamento sem participação pode reproduzir", () => {
    expect(canViewRecording({ ...none, isShareRecipient: true })).toBe(true);
  });
  it("não participante sem compartilhamento é negado (meetingId conhecido não basta)", () => {
    expect(canViewRecording(none)).toBe(false);
  });
  it("admin/owner preservam acesso", () => {
    expect(canViewRecording({ ...none, isWorkspaceAdmin: true })).toBe(true);
    expect(canViewRecording({ ...none, isGlobalAdmin: true })).toBe(true);
  });
  it("menu 'Minhas reuniões' não depende de permissão de gravar", () => {
    const src = readFileSync("src/components/profile/ProfileMenu.tsx", "utf8");
    const idx = src.indexOf('to="/meetings"');
    expect(idx).toBeGreaterThan(0);
    const before = src.slice(Math.max(0, idx - 200), idx);
    expect(before).not.toMatch(/canRecord|can_record|strategic|isAdmin/i);
  });
  it("URL assinada verifica compartilhamento explícito", () => {
    const src = readFileSync("src/lib/meetings/recording.functions.ts", "utf8");
    expect(src).toContain("meeting_recording_shares");
    expect(src).toContain("canViewRecording");
  });
});
