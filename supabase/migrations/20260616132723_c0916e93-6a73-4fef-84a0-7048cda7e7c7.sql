
CREATE TABLE public.account_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.account_groups TO authenticated;
GRANT ALL ON public.account_groups TO service_role;

ALTER TABLE public.account_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read groups"
  ON public.account_groups FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Admins manage groups"
  ON public.account_groups FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER touch_account_groups_updated_at
  BEFORE UPDATE ON public.account_groups
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.profiles
  ADD COLUMN group_id uuid REFERENCES public.account_groups(id) ON DELETE SET NULL;

CREATE INDEX idx_profiles_group_id ON public.profiles(group_id);

-- Seed: cria o grupo Prestativa Virtual e associa todas as contas exceto marcio
INSERT INTO public.account_groups (name, description)
VALUES ('Prestativa Virtual', 'Equipe Prestativa Virtual')
ON CONFLICT (name) DO NOTHING;

UPDATE public.profiles p
SET group_id = (SELECT id FROM public.account_groups WHERE name = 'Prestativa Virtual')
WHERE p.group_id IS NULL
  AND p.id IN (
    SELECT u.id FROM auth.users u
    WHERE u.email IS DISTINCT FROM 'marciotemperine@gmail.com'
  );
