
-- profiles
DROP POLICY IF EXISTS "Profiles readable by authenticated" ON public.profiles;
CREATE POLICY "Profiles readable to self or workspace peers"
  ON public.profiles FOR SELECT TO authenticated
  USING (
    auth.uid() = id
    OR EXISTS (
      SELECT 1 FROM public.workspace_members wm1
      JOIN public.workspace_members wm2 ON wm1.workspace_id = wm2.workspace_id
      WHERE wm1.user_id = auth.uid() AND wm2.user_id = profiles.id
    )
  );

-- user_roles
DROP POLICY IF EXISTS "Roles readable by authenticated" ON public.user_roles;
CREATE POLICY "Users read own roles"
  ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- workspace_invites — remove brecha (email IS NULL)
DROP POLICY IF EXISTS "Invitee or admin reads invite" ON public.workspace_invites;
CREATE POLICY "Invitee or admin reads invite"
  ON public.workspace_invites FOR SELECT TO authenticated
  USING (
    is_workspace_admin(workspace_id, auth.uid())
    OR (email IS NOT NULL AND lower(email) = lower(COALESCE(current_user_email(), '')))
  );

-- desk_notes — restringe a sender/recipient
DROP POLICY IF EXISTS "Members read desk_notes" ON public.desk_notes;
CREATE POLICY "Sender or recipient read desk_notes"
  ON public.desk_notes FOR SELECT TO authenticated
  USING (
    (auth.uid() = sender_id OR auth.uid() = recipient_id)
    AND is_workspace_member(workspace_id, auth.uid())
  );

-- meeting_participants — bloqueia auto-insert
CREATE POLICY "No direct insert into meeting_participants"
  ON public.meeting_participants FOR INSERT TO authenticated
  WITH CHECK (false);
