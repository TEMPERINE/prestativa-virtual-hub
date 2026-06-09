
-- 1) Workspaces: somente admin pode criar / alterar / excluir.
DROP POLICY IF EXISTS "Owner creates workspace" ON public.workspaces;
DROP POLICY IF EXISTS "Owner updates workspace" ON public.workspaces;
DROP POLICY IF EXISTS "Owner deletes workspace" ON public.workspaces;

CREATE POLICY "Admin creates workspace" ON public.workspaces
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admin or owner updates workspace" ON public.workspaces
  FOR UPDATE TO authenticated
  USING (owner_id = auth.uid() OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (owner_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admin or owner deletes workspace" ON public.workspaces
  FOR DELETE TO authenticated
  USING (owner_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

-- map_overrides e custom_props já existem; admin override pra edição cross-workspace
DROP POLICY IF EXISTS "Admin can manage map_overrides" ON public.map_overrides;
CREATE POLICY "Admin can manage map_overrides" ON public.map_overrides
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admin can manage custom_props" ON public.custom_props;
CREATE POLICY "Admin can manage custom_props" ON public.custom_props
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 2) Sprite skins: catálogo de personagens em runtime.
CREATE TABLE IF NOT EXISTS public.sprite_skins (
  id text PRIMARY KEY,
  label text NOT NULL,
  gender text NOT NULL DEFAULT 'n' CHECK (gender IN ('m','f','n')),
  workspace_id uuid NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  sheets jsonb NOT NULL,
  dims jsonb NOT NULL,
  mirror_right_from_left boolean NOT NULL DEFAULT false,
  mirror_left_from_right boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sprite_skins TO authenticated;
GRANT ALL ON public.sprite_skins TO service_role;

ALTER TABLE public.sprite_skins ENABLE ROW LEVEL SECURITY;

-- Qualquer usuário autenticado vê skins globais; skins de workspace só membros daquele ws.
CREATE POLICY "Read global or member workspace skins" ON public.sprite_skins
  FOR SELECT TO authenticated
  USING (
    workspace_id IS NULL
    OR public.is_workspace_member(workspace_id, auth.uid())
    OR public.has_role(auth.uid(), 'admin')
  );

CREATE POLICY "Admin manages skins" ON public.sprite_skins
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER sprite_skins_touch BEFORE UPDATE ON public.sprite_skins
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
