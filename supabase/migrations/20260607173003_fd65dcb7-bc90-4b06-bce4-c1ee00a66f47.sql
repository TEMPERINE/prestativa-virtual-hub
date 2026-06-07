CREATE OR REPLACE FUNCTION public.workspace_accept_invite(_token text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid := auth.uid();
  uemail text;
  inv record;
  ws_tier smallint;
  current_count int;
  max_allowed int;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT email INTO uemail FROM auth.users WHERE id = uid;
  SELECT * INTO inv FROM public.workspace_invites
   WHERE token = _token AND accepted_at IS NULL AND expires_at > now();
  IF inv IS NULL THEN RAISE EXCEPTION 'invite invalid or expired'; END IF;
  IF lower(inv.email) <> lower(uemail) THEN RAISE EXCEPTION 'invite is not for this account'; END IF;

  -- Tier-based member cap. Tier 1 = 2, Tier 2 = 5, Tier 3 = unlimited.
  SELECT tier INTO ws_tier FROM public.workspaces WHERE id = inv.workspace_id;
  max_allowed := CASE COALESCE(ws_tier, 1)
    WHEN 1 THEN 2
    WHEN 2 THEN 5
    ELSE 2147483647
  END;
  SELECT count(*) INTO current_count
    FROM public.workspace_members WHERE workspace_id = inv.workspace_id;
  IF current_count >= max_allowed
     AND NOT EXISTS (SELECT 1 FROM public.workspace_members
                      WHERE workspace_id = inv.workspace_id AND user_id = uid) THEN
    RAISE EXCEPTION 'workspace member limit reached for this tier (%/%, tier %)',
      current_count, max_allowed, COALESCE(ws_tier, 1);
  END IF;

  INSERT INTO public.workspace_members (workspace_id, user_id, role)
  VALUES (inv.workspace_id, uid, inv.role) ON CONFLICT DO NOTHING;
  UPDATE public.workspace_invites SET accepted_at = now() WHERE id = inv.id;
  RETURN inv.workspace_id;
END;
$function$;