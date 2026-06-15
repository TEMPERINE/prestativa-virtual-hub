DROP POLICY IF EXISTS "Sender or recipient read desk_notes" ON public.desk_notes;
CREATE POLICY "Workspace members read desk_notes" ON public.desk_notes
FOR SELECT TO authenticated
USING (is_workspace_member(workspace_id, auth.uid()));