DROP POLICY IF EXISTS "Members or recipients read meetings" ON public.meetings;
CREATE POLICY "Members or recipients read meetings" ON public.meetings FOR SELECT TO authenticated
USING (
  public.is_workspace_member(workspace_id, auth.uid()) AND (
    EXISTS (SELECT 1 FROM public.meeting_participants mp WHERE mp.meeting_id = meetings.id AND mp.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.meeting_recording_shares s WHERE s.meeting_id = meetings.id AND s.recipient_id = auth.uid())
  )
);
CREATE OR REPLACE FUNCTION public.can_read_meeting_participants(_meeting_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.meetings m
    WHERE m.id = _meeting_id AND (
      public.is_workspace_admin(m.workspace_id, _user_id)
      OR public.has_role(_user_id, 'admin') OR public.has_role(_user_id, 'master')
      OR (public.is_workspace_member(m.workspace_id, _user_id)
          AND EXISTS (SELECT 1 FROM public.meeting_recording_shares s WHERE s.meeting_id = m.id AND s.recipient_id = _user_id))
    )
  )
$$;