
-- 1) Signup invites table (super-admin gera; cria workspace novo no redeem)
CREATE TABLE public.signup_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token text NOT NULL UNIQUE DEFAULT encode(extensions.gen_random_bytes(16), 'hex'),
  email text,
  plan public.account_plan NOT NULL DEFAULT 'essencial',
  tier smallint NOT NULL DEFAULT 1 CHECK (tier IN (1,2,3)),
  workspace_name_suggestion text,
  max_uses integer NOT NULL DEFAULT 1 CHECK (max_uses >= 1),
  uses integer NOT NULL DEFAULT 0,
  notes text,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX signup_invites_email_idx ON public.signup_invites (lower(email));
CREATE INDEX signup_invites_created_by_idx ON public.signup_invites (created_by);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.signup_invites TO authenticated;
GRANT ALL ON public.signup_invites TO service_role;

ALTER TABLE public.signup_invites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage signup invites" ON public.signup_invites
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') AND created_by = auth.uid());

CREATE TRIGGER signup_invites_touch BEFORE UPDATE ON public.signup_invites
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 2) Relax workspace_invites: permitir link compartilhável (email nulo + multi-uso)
ALTER TABLE public.workspace_invites ALTER COLUMN email DROP NOT NULL;
ALTER TABLE public.workspace_invites ADD COLUMN IF NOT EXISTS max_uses integer NOT NULL DEFAULT 1 CHECK (max_uses >= 1);
ALTER TABLE public.workspace_invites ADD COLUMN IF NOT EXISTS uses integer NOT NULL DEFAULT 0;

-- Atualiza a policy de SELECT pra cobrir link aberto (email IS NULL ⇒ qualquer auth pode ler)
DROP POLICY IF EXISTS "Invitee or admin reads invite" ON public.workspace_invites;
CREATE POLICY "Invitee or admin reads invite" ON public.workspace_invites
  FOR SELECT TO authenticated
  USING (
    public.is_workspace_admin(workspace_id, auth.uid())
    OR email IS NULL
    OR lower(email) = lower(COALESCE(public.current_user_email(), ''))
  );

-- 3) RPC pública pra peek do convite (sem auth necessária)
CREATE OR REPLACE FUNCTION public.invite_peek(_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  si record;
  wi record;
  ws_name text;
BEGIN
  SELECT * INTO si FROM public.signup_invites WHERE token = _token;
  IF si.id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'kind', 'signup',
      'valid', (si.expires_at > now() AND si.uses < si.max_uses),
      'expires_at', si.expires_at,
      'email_lock', si.email,
      'plan', si.plan,
      'tier', si.tier,
      'workspace_name_suggestion', si.workspace_name_suggestion
    );
  END IF;

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

GRANT EXECUTE ON FUNCTION public.invite_peek(text) TO anon, authenticated;

-- 4) RPC pra redeem do signup_invite (cria workspace + seta plano)
CREATE OR REPLACE FUNCTION public.signup_invite_redeem(_token text, _workspace_name text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  uemail text;
  inv record;
  new_ws_id uuid;
  ws_name text;
  ws_slug text;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT email INTO uemail FROM auth.users WHERE id = uid;

  SELECT * INTO inv FROM public.signup_invites WHERE token = _token FOR UPDATE;
  IF inv.id IS NULL THEN RAISE EXCEPTION 'invite not found'; END IF;
  IF inv.expires_at <= now() THEN RAISE EXCEPTION 'invite expired'; END IF;
  IF inv.uses >= inv.max_uses THEN RAISE EXCEPTION 'invite already used'; END IF;
  IF inv.email IS NOT NULL AND lower(inv.email) <> lower(uemail) THEN
    RAISE EXCEPTION 'invite is not for this account';
  END IF;

  -- Atualiza plano do dono (necessário pro trigger workspaces_enforce_owner_plan)
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
$$;

GRANT EXECUTE ON FUNCTION public.signup_invite_redeem(text, text) TO authenticated;

-- 5) Atualiza workspace_accept_invite pra suportar link aberto (email null, multi-uso)
CREATE OR REPLACE FUNCTION public.workspace_accept_invite(_token text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
    WHERE token = _token AND expires_at > now() FOR UPDATE;
  IF inv IS NULL THEN RAISE EXCEPTION 'invite invalid or expired'; END IF;
  IF inv.uses >= inv.max_uses THEN RAISE EXCEPTION 'invite already used'; END IF;
  IF inv.email IS NOT NULL AND lower(inv.email) <> lower(uemail) THEN
    RAISE EXCEPTION 'invite is not for this account';
  END IF;

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
$$;
