DROP POLICY IF EXISTS "Members read workspaces" ON public.workspaces;
CREATE POLICY "Members or owner read workspaces" ON public.workspaces
  FOR SELECT TO authenticated
  USING (owner_id = auth.uid() OR public.is_workspace_member(id, auth.uid()));