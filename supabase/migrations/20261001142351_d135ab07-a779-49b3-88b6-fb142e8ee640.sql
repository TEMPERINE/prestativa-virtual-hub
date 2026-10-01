CREATE OR REPLACE FUNCTION public.release_claim_on_member_removed()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  DELETE FROM public.workspace_claims WHERE workspace_id = OLD.workspace_id AND user_id = OLD.user_id;
  RETURN OLD;
END; $$;
REVOKE EXECUTE ON FUNCTION public.release_claim_on_member_removed() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS workspace_members_release_claim ON public.workspace_members;
CREATE TRIGGER workspace_members_release_claim AFTER DELETE ON public.workspace_members
FOR EACH ROW EXECUTE FUNCTION public.release_claim_on_member_removed();