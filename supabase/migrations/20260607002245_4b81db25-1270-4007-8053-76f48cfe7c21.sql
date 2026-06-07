
DO $$ BEGIN
  CREATE TYPE public.workspace_role AS ENUM ('owner','admin','member');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE public.workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  cover_url text,
  owner_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workspaces TO authenticated;
GRANT ALL ON public.workspaces TO service_role;
ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER workspaces_touch BEFORE UPDATE ON public.workspaces
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.workspace_members (
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  role public.workspace_role NOT NULL DEFAULT 'member',
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workspace_members TO authenticated;
GRANT ALL ON public.workspace_members TO service_role;
ALTER TABLE public.workspace_members ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.workspace_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  email text NOT NULL,
  role public.workspace_role NOT NULL DEFAULT 'member',
  token text NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(16), 'hex'),
  invited_by uuid NOT NULL,
  accepted_at timestamptz,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX workspace_invites_email_idx ON public.workspace_invites (lower(email));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workspace_invites TO authenticated;
GRANT ALL ON public.workspace_invites TO service_role;
ALTER TABLE public.workspace_invites ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_workspace_member(_workspace_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS(SELECT 1 FROM public.workspace_members
                WHERE workspace_id = _workspace_id AND user_id = _user_id)
$$;

CREATE OR REPLACE FUNCTION public.is_workspace_admin(_workspace_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS(SELECT 1 FROM public.workspace_members
                WHERE workspace_id = _workspace_id AND user_id = _user_id
                  AND role IN ('owner','admin'))
$$;

CREATE OR REPLACE FUNCTION public.current_user_email()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT email FROM auth.users WHERE id = auth.uid()
$$;

CREATE POLICY "Members read workspaces" ON public.workspaces FOR SELECT TO authenticated
  USING (public.is_workspace_member(id, auth.uid()));
CREATE POLICY "Owner creates workspace" ON public.workspaces FOR INSERT TO authenticated
  WITH CHECK (owner_id = auth.uid());
CREATE POLICY "Owner updates workspace" ON public.workspaces FOR UPDATE TO authenticated
  USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
CREATE POLICY "Owner deletes workspace" ON public.workspaces FOR DELETE TO authenticated
  USING (owner_id = auth.uid());

CREATE POLICY "Self reads own memberships" ON public.workspace_members FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "Self leaves workspace" ON public.workspace_members FOR DELETE TO authenticated
  USING (user_id = auth.uid() OR public.is_workspace_admin(workspace_id, auth.uid()));
CREATE POLICY "Admin or self inserts member" ON public.workspace_members FOR INSERT TO authenticated
  WITH CHECK (public.is_workspace_admin(workspace_id, auth.uid()) OR user_id = auth.uid());
CREATE POLICY "Admin updates members" ON public.workspace_members FOR UPDATE TO authenticated
  USING (public.is_workspace_admin(workspace_id, auth.uid()))
  WITH CHECK (public.is_workspace_admin(workspace_id, auth.uid()));

CREATE POLICY "Invitee or admin reads invite" ON public.workspace_invites FOR SELECT TO authenticated
  USING (public.is_workspace_admin(workspace_id, auth.uid())
         OR lower(email) = lower(coalesce(public.current_user_email(), '')));
CREATE POLICY "Admin creates invite" ON public.workspace_invites FOR INSERT TO authenticated
  WITH CHECK (public.is_workspace_admin(workspace_id, auth.uid()) AND invited_by = auth.uid());
CREATE POLICY "Admin deletes invite" ON public.workspace_invites FOR DELETE TO authenticated
  USING (public.is_workspace_admin(workspace_id, auth.uid()));

WITH first_user AS (
  SELECT id FROM auth.users ORDER BY created_at ASC LIMIT 1
), new_ws AS (
  INSERT INTO public.workspaces (slug, name, description, owner_id)
  SELECT 'prestativa-office', 'Prestativa Office',
         'Escritório virtual da Prestativa — onde tudo começou.',
         (SELECT id FROM first_user)
  RETURNING id
)
INSERT INTO public.workspace_members (workspace_id, user_id, role)
SELECT (SELECT id FROM new_ws), u.id,
       CASE WHEN u.id = (SELECT id FROM first_user)
            THEN 'owner'::public.workspace_role
            ELSE 'member'::public.workspace_role END
FROM auth.users u;

DO $$
DECLARE ws uuid;
BEGIN
  SELECT id INTO ws FROM public.workspaces WHERE slug = 'prestativa-office';

  ALTER TABLE public.positions ADD COLUMN workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE;
  UPDATE public.positions SET workspace_id = ws WHERE workspace_id IS NULL;
  ALTER TABLE public.positions ALTER COLUMN workspace_id SET NOT NULL;
  ALTER TABLE public.positions DROP CONSTRAINT positions_pkey;
  ALTER TABLE public.positions ADD CONSTRAINT positions_pkey PRIMARY KEY (workspace_id, user_id);

  ALTER TABLE public.workspace_claims ADD COLUMN workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE;
  UPDATE public.workspace_claims SET workspace_id = ws WHERE workspace_id IS NULL;
  ALTER TABLE public.workspace_claims ALTER COLUMN workspace_id SET NOT NULL;
  ALTER TABLE public.workspace_claims DROP CONSTRAINT workspace_claims_pkey;
  DROP INDEX IF EXISTS public.workspace_claims_user_id_unique;
  ALTER TABLE public.workspace_claims ADD CONSTRAINT workspace_claims_pkey PRIMARY KEY (workspace_id, zone_id);
  ALTER TABLE public.workspace_claims ADD CONSTRAINT workspace_claims_user_unique UNIQUE (workspace_id, user_id);

  ALTER TABLE public.map_overrides ADD COLUMN workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE;
  UPDATE public.map_overrides SET workspace_id = ws WHERE workspace_id IS NULL;
  ALTER TABLE public.map_overrides ALTER COLUMN workspace_id SET NOT NULL;
  DELETE FROM public.map_overrides a USING public.map_overrides b
    WHERE a.workspace_id = b.workspace_id AND a.ctid < b.ctid;
  ALTER TABLE public.map_overrides DROP CONSTRAINT map_overrides_pkey;
  ALTER TABLE public.map_overrides DROP COLUMN id;
  ALTER TABLE public.map_overrides ADD CONSTRAINT map_overrides_pkey PRIMARY KEY (workspace_id);

  ALTER TABLE public.prop_states ADD COLUMN workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE;
  UPDATE public.prop_states SET workspace_id = ws WHERE workspace_id IS NULL;
  ALTER TABLE public.prop_states ALTER COLUMN workspace_id SET NOT NULL;
  ALTER TABLE public.prop_states DROP CONSTRAINT prop_states_pkey;
  ALTER TABLE public.prop_states ADD CONSTRAINT prop_states_pkey PRIMARY KEY (workspace_id, prop_id);

  ALTER TABLE public.custom_props ADD COLUMN workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE;
  UPDATE public.custom_props SET workspace_id = ws WHERE workspace_id IS NULL;
  ALTER TABLE public.custom_props ALTER COLUMN workspace_id SET NOT NULL;
  ALTER TABLE public.custom_props DROP CONSTRAINT custom_props_pkey;
  ALTER TABLE public.custom_props ADD CONSTRAINT custom_props_pkey PRIMARY KEY (workspace_id, id);

  ALTER TABLE public.desk_notes ADD COLUMN workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE;
  UPDATE public.desk_notes SET workspace_id = ws WHERE workspace_id IS NULL;
  ALTER TABLE public.desk_notes ALTER COLUMN workspace_id SET NOT NULL;

  ALTER TABLE public.messages ADD COLUMN workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE;
  UPDATE public.messages SET workspace_id = ws WHERE workspace_id IS NULL;
  ALTER TABLE public.messages ALTER COLUMN workspace_id SET NOT NULL;

  ALTER TABLE public.meetings ADD COLUMN workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE;
  UPDATE public.meetings SET workspace_id = ws WHERE workspace_id IS NULL;
  ALTER TABLE public.meetings ALTER COLUMN workspace_id SET NOT NULL;
END $$;

DROP POLICY IF EXISTS "Positions readable by authenticated" ON public.positions;
DROP POLICY IF EXISTS "Users manage own position" ON public.positions;
CREATE POLICY "Members read positions" ON public.positions FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "User manages own position" ON public.positions FOR ALL TO authenticated
  USING (auth.uid() = user_id AND public.is_workspace_member(workspace_id, auth.uid()))
  WITH CHECK (auth.uid() = user_id AND public.is_workspace_member(workspace_id, auth.uid()));

DROP POLICY IF EXISTS "Claims readable by authenticated" ON public.workspace_claims;
DROP POLICY IF EXISTS "Users delete own claim" ON public.workspace_claims;
DROP POLICY IF EXISTS "Users insert own claim" ON public.workspace_claims;
CREATE POLICY "Members read claims" ON public.workspace_claims FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "Members insert own claim" ON public.workspace_claims FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "Members delete own claim" ON public.workspace_claims FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Map readable by authenticated" ON public.map_overrides;
DROP POLICY IF EXISTS "Admins and supervisors can delete map" ON public.map_overrides;
DROP POLICY IF EXISTS "Admins and supervisors can insert map" ON public.map_overrides;
DROP POLICY IF EXISTS "Admins and supervisors can update map" ON public.map_overrides;
CREATE POLICY "Members read map" ON public.map_overrides FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "Workspace admin upserts map" ON public.map_overrides FOR INSERT TO authenticated
  WITH CHECK (public.is_workspace_admin(workspace_id, auth.uid())
              OR has_role(auth.uid(), 'admin'::app_role)
              OR has_role(auth.uid(), 'supervisor'::app_role));
CREATE POLICY "Workspace admin updates map" ON public.map_overrides FOR UPDATE TO authenticated
  USING (public.is_workspace_admin(workspace_id, auth.uid())
         OR has_role(auth.uid(), 'admin'::app_role)
         OR has_role(auth.uid(), 'supervisor'::app_role))
  WITH CHECK (public.is_workspace_admin(workspace_id, auth.uid())
              OR has_role(auth.uid(), 'admin'::app_role)
              OR has_role(auth.uid(), 'supervisor'::app_role));
CREATE POLICY "Workspace admin deletes map" ON public.map_overrides FOR DELETE TO authenticated
  USING (public.is_workspace_admin(workspace_id, auth.uid())
         OR has_role(auth.uid(), 'admin'::app_role)
         OR has_role(auth.uid(), 'supervisor'::app_role));

DROP POLICY IF EXISTS "Prop states readable" ON public.prop_states;
DROP POLICY IF EXISTS "Prop states insert" ON public.prop_states;
DROP POLICY IF EXISTS "Prop states update" ON public.prop_states;
CREATE POLICY "Members read prop_states" ON public.prop_states FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "Members insert prop_states" ON public.prop_states FOR INSERT TO authenticated
  WITH CHECK (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "Members update prop_states" ON public.prop_states FOR UPDATE TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()))
  WITH CHECK (public.is_workspace_member(workspace_id, auth.uid()));

DROP POLICY IF EXISTS "Custom props readable by authenticated" ON public.custom_props;
DROP POLICY IF EXISTS "Admins/supervisors insert custom props" ON public.custom_props;
DROP POLICY IF EXISTS "Admins/supervisors update custom props" ON public.custom_props;
DROP POLICY IF EXISTS "Admins/supervisors delete custom props" ON public.custom_props;
CREATE POLICY "Members read custom_props" ON public.custom_props FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "Admin inserts custom_props" ON public.custom_props FOR INSERT TO authenticated
  WITH CHECK (public.is_workspace_admin(workspace_id, auth.uid())
              OR has_role(auth.uid(), 'admin'::app_role)
              OR has_role(auth.uid(), 'supervisor'::app_role));
CREATE POLICY "Admin updates custom_props" ON public.custom_props FOR UPDATE TO authenticated
  USING (public.is_workspace_admin(workspace_id, auth.uid())
         OR has_role(auth.uid(), 'admin'::app_role)
         OR has_role(auth.uid(), 'supervisor'::app_role));
CREATE POLICY "Admin deletes custom_props" ON public.custom_props FOR DELETE TO authenticated
  USING (public.is_workspace_admin(workspace_id, auth.uid())
         OR has_role(auth.uid(), 'admin'::app_role)
         OR has_role(auth.uid(), 'supervisor'::app_role));

DROP POLICY IF EXISTS "Desk notes readable by authenticated" ON public.desk_notes;
DROP POLICY IF EXISTS "Recipient or sender deletes note" ON public.desk_notes;
DROP POLICY IF EXISTS "Recipient updates own note" ON public.desk_notes;
DROP POLICY IF EXISTS "Senders create their own notes" ON public.desk_notes;
CREATE POLICY "Members read desk_notes" ON public.desk_notes FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "Members send desk_note" ON public.desk_notes FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = sender_id AND sender_id <> recipient_id
              AND public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "Recipient updates desk_note" ON public.desk_notes FOR UPDATE TO authenticated
  USING (auth.uid() = recipient_id) WITH CHECK (auth.uid() = recipient_id);
CREATE POLICY "Recipient or sender deletes desk_note" ON public.desk_notes FOR DELETE TO authenticated
  USING (auth.uid() = recipient_id OR auth.uid() = sender_id);

DROP POLICY IF EXISTS "Messages readable by authenticated" ON public.messages;
DROP POLICY IF EXISTS "Users send own messages" ON public.messages;
CREATE POLICY "Members read messages" ON public.messages FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "Members send messages" ON public.messages FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = sender_id AND public.is_workspace_member(workspace_id, auth.uid()));

DROP POLICY IF EXISTS "User reads meetings they joined" ON public.meetings;
CREATE POLICY "Members read workspace meetings" ON public.meetings FOR SELECT TO authenticated
  USING (
    public.is_workspace_member(workspace_id, auth.uid())
    AND EXISTS (SELECT 1 FROM public.meeting_participants mp
                WHERE mp.meeting_id = meetings.id AND mp.user_id = auth.uid())
  );

CREATE OR REPLACE FUNCTION public.meeting_join(_workspace_id uuid, _zone_id text, _zone_label text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); active_meeting uuid;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF NOT public.is_workspace_member(_workspace_id, uid) THEN
    RAISE EXCEPTION 'not a workspace member';
  END IF;
  SELECT id INTO active_meeting FROM public.meetings
   WHERE workspace_id = _workspace_id AND zone_id = _zone_id AND ended_at IS NULL
     AND started_at > now() - interval '6 hours'
   ORDER BY started_at DESC LIMIT 1;
  IF active_meeting IS NULL THEN
    INSERT INTO public.meetings (workspace_id, zone_id, zone_label, host_id)
    VALUES (_workspace_id, _zone_id, _zone_label, uid) RETURNING id INTO active_meeting;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.meeting_participants
                 WHERE meeting_id = active_meeting AND user_id = uid AND left_at IS NULL) THEN
    INSERT INTO public.meeting_participants (meeting_id, user_id) VALUES (active_meeting, uid);
  END IF;
  RETURN active_meeting;
END; $$;

DROP FUNCTION IF EXISTS public.meeting_join(text, text);

CREATE OR REPLACE FUNCTION public.meeting_set_recording(_meeting_id uuid, _path text, _duration_seconds integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); m_zone text; m_ws uuid;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF NOT public.is_meeting_participant(_meeting_id, uid) THEN RAISE EXCEPTION 'not a participant'; END IF;
  UPDATE public.meetings
  SET recording_path = _path, recording_duration_seconds = _duration_seconds,
      recorded_by = uid, recording_uploaded_at = now()
  WHERE id = _meeting_id RETURNING zone_id, workspace_id INTO m_zone, m_ws;
  IF m_zone IS NOT NULL AND m_ws IS NOT NULL THEN
    INSERT INTO public.meeting_participants (meeting_id, user_id)
    SELECT _meeting_id, p.user_id FROM public.positions p
     WHERE p.zone = m_zone AND p.workspace_id = m_ws AND p.is_online = true
       AND NOT EXISTS (SELECT 1 FROM public.meeting_participants mp
                       WHERE mp.meeting_id = _meeting_id AND mp.user_id = p.user_id);
  END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.workspace_accept_invite(_token text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); uemail text; inv record;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT email INTO uemail FROM auth.users WHERE id = uid;
  SELECT * INTO inv FROM public.workspace_invites
   WHERE token = _token AND accepted_at IS NULL AND expires_at > now();
  IF inv IS NULL THEN RAISE EXCEPTION 'invite invalid or expired'; END IF;
  IF lower(inv.email) <> lower(uemail) THEN RAISE EXCEPTION 'invite is not for this account'; END IF;
  INSERT INTO public.workspace_members (workspace_id, user_id, role)
  VALUES (inv.workspace_id, uid, inv.role) ON CONFLICT DO NOTHING;
  UPDATE public.workspace_invites SET accepted_at = now() WHERE id = inv.id;
  RETURN inv.workspace_id;
END; $$;

ALTER PUBLICATION supabase_realtime ADD TABLE public.workspaces;
ALTER PUBLICATION supabase_realtime ADD TABLE public.workspace_members;
