/**
 * Regra única de acesso à gravação (independe de quem clicou em Gravar
 * e de can_record_meeting / member_profile).
 */
export interface RecordingAccessInput {
  isParticipant: boolean;
  isShareRecipient: boolean;
  isWorkspaceAdmin: boolean;
  isGlobalAdmin: boolean;
}

export function canViewRecording(a: RecordingAccessInput): boolean {
  return a.isParticipant || a.isShareRecipient || a.isWorkspaceAdmin || a.isGlobalAdmin;
}
