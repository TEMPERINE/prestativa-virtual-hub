import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { canViewRecording, showMyMeetingsMenu, visibleMeetings, receivedRecordings, type MeetingRow } from "../recording-access";
import { canRecordMeeting } from "../record-permission";

const none = { isActiveMember: true, isParticipant: false, isShareRecipient: false, isWorkspaceAdmin: false, isGlobalAdmin: false };
const W1 = "ws-1", W2 = "ws-2";
const rows: MeetingRow[] = [
  { id: "m1", workspace_id: W1, participants: ["marcio", "isadora"], recipients: [] },
  { id: "m2", workspace_id: W1, participants: ["marcio"], recipients: ["isadora"] },
  { id: "m3", workspace_id: W1, participants: ["marcio"], recipients: [] },
  { id: "m4", workspace_id: W2, participants: ["outro"], recipients: ["isadora"] },
];

describe("acesso à gravação separado de CAN_RECORD", () => {
  it("participante ativo pode reproduzir", () => {
    expect(canViewRecording({ ...none, isParticipant: true })).toBe(true);
  });
  it("destinatário com membership ativo pode reproduzir", () => {
    expect(canViewRecording({ ...none, isShareRecipient: true })).toBe(true);
  });
  it("não participante sem compartilhamento é negado", () => {
    expect(canViewRecording(none)).toBe(false);
  });
  it("membro removido/inativo é bloqueado mesmo tendo participado ou recebido", () => {
    expect(canViewRecording({ ...none, isActiveMember: false, isParticipant: true })).toBe(false);
    expect(canViewRecording({ ...none, isActiveMember: false, isShareRecipient: true })).toBe(false);
  });
  it("usuário de outro workspace é bloqueado", () => {
    expect(canViewRecording({ ...none, isActiveMember: false, isShareRecipient: true })).toBe(false);
    expect(visibleMeetings(rows, "isadora", new Set([W1])).map((m) => m.id)).not.toContain("m4");
  });
  it("admin/owner mantêm acesso", () => {
    expect(canViewRecording({ ...none, isActiveMember: false, isWorkspaceAdmin: true })).toBe(true);
    expect(canViewRecording({ ...none, isActiveMember: false, isGlobalAdmin: true })).toBe(true);
  });
});

describe("lista de reuniões", () => {
  it("participante vê a reunião", () => {
    expect(visibleMeetings(rows, "isadora", new Set([W1])).map((m) => m.id)).toContain("m1");
  });
  it("não participante não vê a reunião", () => {
    expect(visibleMeetings(rows, "isadora", new Set([W1])).map((m) => m.id)).not.toContain("m3");
  });
  it("compartilhada aparece em Gravações recebidas", () => {
    expect(receivedRecordings(rows, "isadora", new Set([W1])).map((m) => m.id)).toEqual(["m2"]);
  });
  it("membro removido não vê nada", () => {
    expect(visibleMeetings(rows, "isadora", new Set())).toEqual([]);
  });
  it("policy do banco exige membership também para compartilhadas", () => {
    const sql = readFileSync("supabase/migrations/" + require("node:fs").readdirSync("supabase/migrations").sort().reverse()
      .find((f: string) => readFileSync("supabase/migrations/" + f, "utf8").includes("Members or recipients read meetings")), "utf8");
    expect(sql).toMatch(/is_workspace_member\(workspace_id, auth\.uid\(\)\) AND \(/);
  });
});

describe("menu e botão Gravar", () => {
  it("Operational não vê botão Gravar", () => {
    expect(canRecordMeeting({ workspaceRole: "member", memberProfile: "operational" })).toBe(false);
  });
  it("menu Minhas reuniões independe de canRecord", () => {
    expect(showMyMeetingsMenu({ authenticated: true, canRecord: false })).toBe(true);
    const src = readFileSync("src/components/profile/ProfileMenu.tsx", "utf8");
    const idx = src.indexOf('to="/meetings"');
    expect(idx).toBeGreaterThan(0);
    expect(src.slice(Math.max(0, idx - 200), idx)).not.toMatch(/canRecord|can_record|strategic|isAdmin/i);
  });
  it("menu tem altura máxima e scroll", () => {
    const src = readFileSync("src/components/profile/ProfileMenu.tsx", "utf8");
    expect(src).toContain("max-h-[var(--radix-popover-content-available-height)]");
    expect(src).toContain("overflow-y-auto");
  });
  it("URL assinada verifica membership e compartilhamento", () => {
    const src = readFileSync("src/lib/meetings/recording.functions.ts", "utf8");
    expect(src).toContain("is_workspace_member");
    expect(src).toContain("meeting_recording_shares");
  });
});
