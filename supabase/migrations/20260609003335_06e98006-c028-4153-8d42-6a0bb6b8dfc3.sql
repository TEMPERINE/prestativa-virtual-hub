CREATE OR REPLACE FUNCTION public.signup_invite_redeem(_token text, _workspace_name text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid := auth.uid();
  inv record;
  new_ws_id uuid;
  ws_name text;
  ws_slug text;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  SELECT * INTO inv FROM public.signup_invites WHERE token = _token FOR UPDATE;
  IF inv.id IS NULL THEN RAISE EXCEPTION 'invite not found'; END IF;
  IF inv.expires_at <= now() THEN RAISE EXCEPTION 'invite expired'; END IF;
  IF inv.uses >= inv.max_uses THEN RAISE EXCEPTION 'invite already used'; END IF;

  -- Atualiza plano do dono
  UPDATE public.profiles SET plan = inv.plan WHERE id = uid;

  ws_name := COALESCE(NULLIF(btrim(_workspace_name), ''), inv.workspace_name_suggestion, 'Meu espaço');
  ws_slug := lower(regexp_replace(ws_name, '[^a-zA-Z0-9]+', '-', 'g')) || '-' || substr(encode(extensions.gen_random_bytes(4),'hex'),1,6);

  INSERT INTO public.workspaces (slug, name, owner_id, tier)
  VALUES (ws_slug, ws_name, uid, inv.tier)
  RETURNING id INTO new_ws_id;

  INSERT INTO public.workspace_members (workspace_id, user_id, role)
  VALUES (new_ws_id, uid, 'owner')
  ON CONFLICT DO NOTHING;

  UPDATE public.signup_invites SET uses = uses + 1 WHERE id = inv.id;

  RETURN new_ws_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.workspace_accept_invite(_token text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid := auth.uid();
  inv record;
  ws_tier smallint;
  current_count int;
  max_allowed int;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  SELECT * INTO inv FROM public.workspace_invites
    WHERE token = _token AND expires_at > now() FOR UPDATE;
  IF inv IS NULL THEN RAISE EXCEPTION 'invite invalid or expired'; END IF;
  IF inv.uses >= inv.max_uses THEN RAISE EXCEPTION 'invite already used'; END IF;

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

  UPDATE public.workspace_invites
    SET uses = uses + 1,
        accepted_at = CASE WHEN max_uses = 1 THEN now() ELSE accepted_at END
    WHERE id = inv.id;

  RETURN inv.workspace_id;
END;
$function$;