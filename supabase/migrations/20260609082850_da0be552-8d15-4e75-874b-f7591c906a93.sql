
-- 1) Remove signup_invites + função de redeem
DROP FUNCTION IF EXISTS public.signup_invite_redeem(text, text);
DROP TABLE IF EXISTS public.signup_invites CASCADE;

-- 2) Recria invite_peek considerando só workspace_invites
CREATE OR REPLACE FUNCTION public.invite_peek(_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  wi record;
  ws_name text;
BEGIN
  SELECT * INTO wi FROM public.workspace_invites WHERE token = _token;
  IF wi.id IS NOT NULL THEN
    SELECT name INTO ws_name FROM public.workspaces WHERE id = wi.workspace_id;
    RETURN jsonb_build_object(
      'kind', 'member',
      'valid', (wi.expires_at > now() AND wi.accepted_at IS NULL AND wi.uses < wi.max_uses),
      'expires_at', wi.expires_at,
      'email_lock', wi.email,
      'workspace_name', ws_name,
      'role', wi.role
    );
  END IF;

  RETURN jsonb_build_object('kind', null, 'valid', false);
END;
$$;
