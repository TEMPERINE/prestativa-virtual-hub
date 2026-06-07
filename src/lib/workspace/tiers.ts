// Níveis de escritório — fonte única de verdade do que cada tier libera.
// Tier 1 = básico (1-2 pessoas), 2 = intermediário (até 5), 3 = ilimitado (Prestativa).

export type WorkspaceTier = 1 | 2 | 3;

export type TierCapabilities = {
  tier: WorkspaceTier;
  label: string;
  shortLabel: string;
  description: string;
  // Limites
  maxMembers: number; // Infinity = sem limite
  maxOnlineCharacters: number; // posições simultâneas no cenário
  // Features
  canChangeSprite: boolean; // usuário pode trocar o personagem
  canTeleport: boolean;
  canMeetingAV: boolean; // entrar em reuniões com vídeo/áudio
  canRecordMeetings: boolean; // botão de gravar + IA
  canUploadCustomTheme: boolean; // upload de imagem de tema
  // Tema-padrão do nível (id em OFFICE_THEMES). null = sem tema imposto.
  defaultThemeId: string | null;
  // Sprites fixos quando o usuário não pode escolher.
  forcedSpriteIds?: string[]; // distribui ciclicamente entre as pessoas
};

export const TIERS: Record<WorkspaceTier, TierCapabilities> = {
  1: {
    tier: 1,
    label: "Nível 1 — Essencial",
    shortLabel: "Nível 1",
    description:
      "Para 1 a 2 pessoas. Apenas chat e presença no cenário. Sem reuniões A/V, sem gravação, sem teleporte. Personagem fixo (afro/loira).",
    maxMembers: 2,
    maxOnlineCharacters: 2,
    canChangeSprite: false,
    canTeleport: false,
    canMeetingAV: false,
    canRecordMeetings: false,
    canUploadCustomTheme: false,
    defaultThemeId: "nivel-1",
    forcedSpriteIds: ["afro", "loira"],
  },
  2: {
    tier: 2,
    label: "Nível 2 — Time",
    shortLabel: "Nível 2",
    description:
      "Para até 5 pessoas. Reuniões com vídeo e áudio liberadas. Sem gravação automática nem IA.",
    maxMembers: 5,
    maxOnlineCharacters: 5,
    canChangeSprite: true,
    canTeleport: true,
    canMeetingAV: true,
    canRecordMeetings: false,
    canUploadCustomTheme: false,
    defaultThemeId: "nivel-2",
  },
  3: {
    tier: 3,
    label: "Nível 3 — Empresa",
    shortLabel: "Nível 3",
    description:
      "Sem limites. Membros ilimitados, gravação + transcrição/resumo por IA, temas customizados e tudo o mais.",
    maxMembers: Infinity,
    maxOnlineCharacters: Infinity,
    canChangeSprite: true,
    canTeleport: true,
    canMeetingAV: true,
    canRecordMeetings: true,
    canUploadCustomTheme: true,
    defaultThemeId: null,
  },
};

export function getTierCaps(tier: number | null | undefined): TierCapabilities {
  const t = (tier === 2 || tier === 3 ? tier : 1) as WorkspaceTier;
  return TIERS[t];
}

export function isUnlimited(n: number): boolean {
  return !Number.isFinite(n);
}
