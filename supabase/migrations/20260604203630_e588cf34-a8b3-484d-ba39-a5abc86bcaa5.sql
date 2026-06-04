
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS sprite_id text NOT NULL DEFAULT 'marcio',
  ADD COLUMN IF NOT EXISTS tagline text,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'available',
  ADD COLUMN IF NOT EXISTS onboarded_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'profiles_status_check'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_status_check
      CHECK (status IN ('available','busy','away'));
  END IF;
END $$;

-- Seed: para usuários existentes (já estavam usando a app antes do onboarding),
-- considere-os já onboarded para não disparar o wizard.
UPDATE public.profiles
   SET onboarded_at = COALESCE(onboarded_at, now()),
       sprite_id    = COALESCE(NULLIF(sprite_id, ''), 'marcio')
 WHERE onboarded_at IS NULL;

-- Atualiza o perfil do Márcio (email marciotemperine@gmail.com): nome curto + cor roxa.
UPDATE public.profiles p
   SET display_name = 'Márcio',
       avatar_color = '#9b5cf6'
  FROM auth.users u
 WHERE u.id = p.id
   AND u.email = 'marciotemperine@gmail.com';
