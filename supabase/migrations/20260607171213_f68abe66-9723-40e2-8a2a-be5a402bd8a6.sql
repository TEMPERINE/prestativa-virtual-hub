-- Tier de escritório (1, 2 ou 3). Define limites e features liberadas.
ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS tier smallint NOT NULL DEFAULT 1
  CHECK (tier IN (1, 2, 3));

-- Prestativa Office é nível 3 (sem limites).
UPDATE public.workspaces SET tier = 3 WHERE slug = 'prestativa-office';

CREATE INDEX IF NOT EXISTS workspaces_tier_idx ON public.workspaces(tier);