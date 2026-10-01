ALTER TABLE public.workspace_members
  ADD COLUMN IF NOT EXISTS member_profile text NOT NULL DEFAULT 'operational';
UPDATE public.workspace_members SET member_profile = 'operational' WHERE member_profile IS DISTINCT FROM 'operational' AND member_profile IS DISTINCT FROM 'strategic';
ALTER TABLE public.workspace_members
  ADD CONSTRAINT workspace_members_member_profile_check CHECK (member_profile IN ('operational','strategic'));

-- Impede autopromoção a Estratégico por quem não é admin
CREATE OR REPLACE FUNCTION public.workspace_members_guard_profile()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.member_profile = 'strategic'
     AND (TG_OP = 'INSERT' OR OLD.member_profile IS DISTINCT FROM NEW.member_profile)
     AND auth.uid() IS NOT NULL
     AND NOT public.is_workspace_admin(NEW.workspace_id, auth.uid())
     AND NOT public.has_role(auth.uid(), 'admin')
     AND NOT public.has_role(auth.uid(), 'master') THEN
    NEW.member_profile := 'operational';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER workspace_members_guard_profile
  BEFORE INSERT OR UPDATE ON public.workspace_members
  FOR EACH ROW EXECUTE FUNCTION public.workspace_members_guard_profile();

-- Resolução central: quem pode iniciar gravações
CREATE OR REPLACE FUNCTION public.can_record_meeting(_user_id uuid, _workspace_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    EXISTS (
      SELECT 1 FROM public.workspace_members m
      WHERE m.user_id = _user_id AND m.workspace_id = _workspace_id
        AND (m.role IN ('owner','admin') OR m.member_profile = 'strategic')
    )
    OR EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = _workspace_id AND w.owner_id = _user_id)
    OR (
      public.is_workspace_member(_workspace_id, _user_id)
      AND EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = _user_id AND r.role IN ('admin','master','supervisor'))
    )
$$;
REVOKE EXECUTE ON FUNCTION public.can_record_meeting(uuid, uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.can_record_meeting(uuid, uuid) TO authenticated, service_role;