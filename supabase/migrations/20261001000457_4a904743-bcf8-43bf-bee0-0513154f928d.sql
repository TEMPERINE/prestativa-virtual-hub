CREATE OR REPLACE FUNCTION public.can_read_meeting_participants(_meeting_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.meetings m
    WHERE m.id = _meeting_id AND (
      public.is_workspace_admin(m.workspace_id, _user_id)
      OR public.has_role(_user_id, 'admin') OR public.has_role(_user_id, 'master')
      OR EXISTS (SELECT 1 FROM public.meeting_recording_shares s WHERE s.meeting_id = m.id AND s.recipient_id = _user_id)
    )
  )
$$;
DROP POLICY IF EXISTS "Participants and admins read meeting participants" ON public.meeting_participants;
CREATE POLICY "Participants and admins read meeting participants" ON public.meeting_participants
FOR SELECT TO authenticated USING (
  user_id = auth.uid()
  OR public.is_meeting_participant(meeting_id, auth.uid())
  OR public.can_read_meeting_participants(meeting_id, auth.uid())
);