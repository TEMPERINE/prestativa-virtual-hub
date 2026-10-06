/**
 * Regra única de acesso à gravação (independe de quem clicou em Gravar
 * e de can_record_meeting / member_profile).
 * Participante/destinatário só acessa com membership ativo no workspace
 * da reunião; admin do workspace e admin global mantêm acesso.
 */
export interface RecordingAccessInput {
  isActiveMember: boolean;
  isParticipant: boolean;
  isShareRecipient: boolean;
  isWorkspaceAdmin: boolean;
  isGlobalAdmin: boolean;
}

export function canViewRecording(a: RecordingAccessInput): boolean {
  if (a.isWorkspaceAdmin || a.isGlobalAdmin) return true;
  if (!a.isActiveMember) return false;
  return a.isParticipant || a.isShareRecipient;
}

/** Item "Minhas reuniões" do menu: só exige estar autenticado/membro. */
export function showMyMeetingsMenu(_ctx: { authenticated: boolean; canRecord?: boolean }): boolean {
  return _ctx.authenticated;
}

export interface MeetingRow { id: string; workspace_id: string; participants: string[]; recipients: string[] }

/** Espelho da policy de leitura de `meetings` (membro E (participante OU destinatário)). */
export function visibleMeetings(rows: MeetingRow[], userId: string, memberOf: Set<string>) {
  return rows.filter((m) => memberOf.has(m.workspace_id) && (m.participants.includes(userId) || m.recipients.includes(userId)));
}

/** "Gravações recebidas": compartilhadas comigo onde não participei. */
export function receivedRecordings(rows: MeetingRow[], userId: string, memberOf: Set<string>) {
  return visibleMeetings(rows, userId, memberOf).filter((m) => m.recipients.includes(userId) && !m.participants.includes(userId));
}
