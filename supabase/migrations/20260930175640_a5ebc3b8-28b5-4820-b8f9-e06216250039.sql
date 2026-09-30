CREATE TABLE public.map_save_points (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  data jsonb NOT NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX map_save_points_ws_idx ON public.map_save_points(workspace_id, created_at DESC);
GRANT SELECT, INSERT, DELETE ON public.map_save_points TO authenticated;
GRANT ALL ON public.map_save_points TO service_role;
ALTER TABLE public.map_save_points ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members read save points" ON public.map_save_points FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()) OR public.has_role(auth.uid(),'master'));
CREATE POLICY "admins create save points" ON public.map_save_points FOR INSERT TO authenticated
  WITH CHECK ((public.is_workspace_admin(workspace_id, auth.uid()) OR public.has_role(auth.uid(),'master')) AND created_by = auth.uid());
CREATE POLICY "admins delete save points" ON public.map_save_points FOR DELETE TO authenticated
  USING (public.is_workspace_admin(workspace_id, auth.uid()) OR public.has_role(auth.uid(),'master'));