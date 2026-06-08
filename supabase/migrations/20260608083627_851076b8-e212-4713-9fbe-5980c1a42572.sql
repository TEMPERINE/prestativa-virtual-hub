
-- 1) Enum de planos de conta
DO $$ BEGIN
  CREATE TYPE public.account_plan AS ENUM ('essencial', 'pro', 'premium');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2) Coluna plan em profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS plan public.account_plan NOT NULL DEFAULT 'essencial';

CREATE INDEX IF NOT EXISTS profiles_plan_idx ON public.profiles(plan);

-- 3) Função: dado um plano, devolve true se ele libera o tier informado.
CREATE OR REPLACE FUNCTION public.account_plan_allows_tier(_plan public.account_plan, _tier smallint)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE _plan
    WHEN 'essencial' THEN _tier = 1
    WHEN 'pro'       THEN _tier IN (1, 2)
    WHEN 'premium'   THEN _tier IN (1, 2, 3)
  END;
$$;

-- 4) Função: maior tier permitido por plano (útil pro front).
CREATE OR REPLACE FUNCTION public.account_plan_max_tier(_plan public.account_plan)
RETURNS smallint
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE _plan
    WHEN 'essencial' THEN 1::smallint
    WHEN 'pro'       THEN 2::smallint
    WHEN 'premium'   THEN 3::smallint
  END;
$$;

-- 5) Trigger: ao criar/alterar workspace, valida que o tier cabe no plano do dono.
CREATE OR REPLACE FUNCTION public.workspaces_enforce_owner_plan()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  owner_plan public.account_plan;
BEGIN
  SELECT plan INTO owner_plan FROM public.profiles WHERE id = NEW.owner_id;
  IF owner_plan IS NULL THEN
    owner_plan := 'essencial';
  END IF;
  IF NOT public.account_plan_allows_tier(owner_plan, NEW.tier) THEN
    RAISE EXCEPTION 'Plano % do dono não permite escritório de nível %', owner_plan, NEW.tier
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS workspaces_enforce_owner_plan_trg ON public.workspaces;
CREATE TRIGGER workspaces_enforce_owner_plan_trg
  BEFORE INSERT OR UPDATE OF tier, owner_id ON public.workspaces
  FOR EACH ROW EXECUTE FUNCTION public.workspaces_enforce_owner_plan();
