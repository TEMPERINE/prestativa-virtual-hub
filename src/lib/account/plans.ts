// Planos de CONTA do Virtual Office (separado do nível do ESCRITÓRIO).
//
// O usuário tem uma conta Prestativa Virtual Office com perfil + personagem
// e UM ou MAIS escritórios. Cada plano de conta define quais NÍVEIS de
// escritório ele pode criar/operar:
//
//   - Essencial → escritórios nível 1
//   - Pro       → escritórios nível 1 e 2
//   - Premium   → escritórios nível 1, 2 e 3
//
// A regra é também aplicada no banco via trigger `workspaces_enforce_owner_plan`,
// então qualquer tentativa de criar/promover workspace fora do plano falha
// mesmo se o front errar.

import type { WorkspaceTier } from "@/lib/workspace/tiers";

export type AccountPlan = "essencial" | "pro" | "premium";

export type AccountPlanInfo = {
  id: AccountPlan;
  label: string;
  shortLabel: string;
  description: string;
  allowedTiers: WorkspaceTier[];
  maxTier: WorkspaceTier;
  /** Cor de destaque pra badge do plano. */
  badgeClass: string;
};

export const ACCOUNT_PLANS: Record<AccountPlan, AccountPlanInfo> = {
  essencial: {
    id: "essencial",
    label: "Plano Essencial",
    shortLabel: "Essencial",
    description: "Acesso a escritórios de nível 1 (1 a 2 pessoas).",
    allowedTiers: [1],
    maxTier: 1,
    badgeClass: "bg-muted text-foreground",
  },
  pro: {
    id: "pro",
    label: "Plano Pro",
    shortLabel: "Pro",
    description: "Acesso a escritórios de nível 1 e 2 (até 5 pessoas).",
    allowedTiers: [1, 2],
    maxTier: 2,
    badgeClass: "bg-primary/15 text-primary",
  },
  premium: {
    id: "premium",
    label: "Plano Premium",
    shortLabel: "Premium",
    description: "Acesso a escritórios de nível 1, 2 e 3 (ilimitado).",
    allowedTiers: [1, 2, 3],
    maxTier: 3,
    badgeClass: "gradient-primary text-primary-foreground",
  },
};

export const DEFAULT_PLAN: AccountPlan = "essencial";

export function getPlanInfo(plan: AccountPlan | string | null | undefined): AccountPlanInfo {
  if (plan && plan in ACCOUNT_PLANS) return ACCOUNT_PLANS[plan as AccountPlan];
  return ACCOUNT_PLANS[DEFAULT_PLAN];
}

export function planAllowsTier(
  plan: AccountPlan | string | null | undefined,
  tier: number
): boolean {
  const info = getPlanInfo(plan);
  return info.allowedTiers.includes(tier as WorkspaceTier);
}

export function allowedTiersForPlan(
  plan: AccountPlan | string | null | undefined
): WorkspaceTier[] {
  return getPlanInfo(plan).allowedTiers;
}
