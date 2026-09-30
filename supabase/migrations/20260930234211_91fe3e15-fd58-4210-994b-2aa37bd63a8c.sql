DROP POLICY IF EXISTS "User reads own participation" ON public.meeting_participants;

CREATE POLICY "Participants and admins read meeting participants"
ON public.meeting_participants
FOR SELECT
TO authenticated
USING (
  user_id = auth.uid()
  OR public.is_meeting_participant(meeting_id, auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.meetings m
    WHERE m.id = meeting_participants.meeting_id
      AND (
        public.is_workspace_admin(m.workspace_id, auth.uid())
        OR public.has_role(auth.uid(), 'admin')
        OR public.has_role(auth.uid(), 'master')
        OR EXISTS (
          SELECT 1 FROM public.meeting_recording_shares s
          WHERE s.meeting_id = m.id AND s.recipient_id = auth.uid()
        )
      )
  )
);