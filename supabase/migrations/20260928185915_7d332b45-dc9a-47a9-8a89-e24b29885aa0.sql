-- RTC v2 Etapa 2: sessões únicas, telemetria, versão de mapa e autorização Realtime privada (aditiva)

-- 1. office_sessions
CREATE TABLE IF NOT EXISTS public.office_sessions (
  user_id uuid PRIMARY KEY,
  session_id uuid NOT NULL,
  generation bigint NOT NULL DEFAULT 1,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  active boolean NOT NULL DEFAULT true,
  claimed_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.office_sessions TO authenticated;
GRANT ALL ON public.office_sessions TO service_role;
ALTER TABLE public.office_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own office session" ON public.office_sessions
  FOR SELECT TO authenticated USING (user_id = auth.uid());

-- 2. claim
CREATE OR REPLACE FUNCTION public.claim_office_session(_session_id uuid, _workspace_id uuid)
RETURNS TABLE(session_id uuid, generation bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not authenticated' USING ERRCODE = '28000'; END IF;
  IF _session_id IS NULL OR _workspace_id IS NULL THEN RAISE EXCEPTION 'invalid arguments' USING ERRCODE = '22023'; END IF;
  IF NOT public.is_workspace_member(_workspace_id, uid) THEN
    RAISE EXCEPTION 'not a workspace member' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  INSERT INTO public.office_sessions AS s (user_id, session_id, generation, workspace_id, active, claimed_at, updated_at)
  VALUES (uid, _session_id, 1, _workspace_id, true, now(), now())
  ON CONFLICT (user_id) DO UPDATE
    SET session_id = EXCLUDED.session_id,
        generation = s.generation + 1,
        workspace_id = EXCLUDED.workspace_id,
        active = true,
        claimed_at = now(),
        updated_at = now()
  RETURNING s.session_id, s.generation;
END; $$;

-- 3. release
CREATE OR REPLACE FUNCTION public.release_office_session(_session_id uuid, _generation bigint)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE uid uuid := auth.uid(); n int;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not authenticated' USING ERRCODE = '28000'; END IF;
  UPDATE public.office_sessions
     SET active = false, updated_at = now()
   WHERE user_id = uid AND session_id = _session_id AND generation = _generation AND active = true;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n > 0;
END; $$;

REVOKE ALL ON FUNCTION public.claim_office_session(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.release_office_session(uuid, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_office_session(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.release_office_session(uuid, bigint) TO authenticated, service_role;

-- 4. rtc_events (append-only)
CREATE TABLE IF NOT EXISTS public.rtc_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL DEFAULT auth.uid(),
  session_id uuid,
  generation bigint,
  workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE,
  zone_id text,
  map_version bigint,
  context text,
  room_name text,
  event_type text NOT NULL,
  connection_state text,
  disconnect_reason text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rtc_events_ws_created_idx ON public.rtc_events (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS rtc_events_user_created_idx ON public.rtc_events (user_id, created_at DESC);
GRANT SELECT, INSERT ON public.rtc_events TO authenticated;
GRANT ALL ON public.rtc_events TO service_role;
ALTER TABLE public.rtc_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users insert own rtc events" ON public.rtc_events
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid()
    AND (workspace_id IS NULL OR public.is_workspace_member(workspace_id, auth.uid())));
CREATE POLICY "Users read own rtc events" ON public.rtc_events
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Admins read workspace rtc events" ON public.rtc_events
  FOR SELECT TO authenticated
  USING ((workspace_id IS NOT NULL AND public.is_workspace_admin(workspace_id, auth.uid()))
         OR public.has_role(auth.uid(), 'admin'::app_role));

-- 5/6. map_overrides.version + incremento atômico
ALTER TABLE public.map_overrides ADD COLUMN IF NOT EXISTS version bigint NOT NULL DEFAULT 1;

CREATE OR REPLACE FUNCTION public.map_overrides_bump_version()
RETURNS trigger LANGUAGE plpgsql SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.version := 1;
  ELSE
    NEW.version := OLD.version + 1;
  END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.map_overrides_bump_version() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS map_overrides_bump_version_trg ON public.map_overrides;
CREATE TRIGGER map_overrides_bump_version_trg
  BEFORE INSERT OR UPDATE ON public.map_overrides
  FOR EACH ROW EXECUTE FUNCTION public.map_overrides_bump_version();

-- 7. Autorização Realtime privada (tópicos RTC v2). Não altera canais públicos do v1.
CREATE OR REPLACE FUNCTION public.rtc_can_access_topic(_topic text)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE uid uuid := auth.uid(); parts text[];
BEGIN
  IF uid IS NULL OR _topic IS NULL THEN RETURN false; END IF;
  parts := string_to_array(_topic, ':');
  IF array_length(parts, 1) <> 3 THEN RETURN false; END IF;
  IF parts[1] = 'workspace' AND parts[3] IN ('presence','movement','map')
     AND parts[2] ~* '^[0-9a-f-]{36}$' THEN
    RETURN public.is_workspace_member(parts[2]::uuid, uid);
  END IF;
  IF parts[1] = 'user' AND parts[3] = 'session' AND parts[2] ~* '^[0-9a-f-]{36}$' THEN
    RETURN parts[2]::uuid = uid;
  END IF;
  RETURN false;
END; $$;
REVOKE ALL ON FUNCTION public.rtc_can_access_topic(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rtc_can_access_topic(text) TO authenticated, service_role;

CREATE POLICY "RTC v2 private topics read" ON realtime.messages
  FOR SELECT TO authenticated
  USING (public.rtc_can_access_topic(realtime.topic()));
CREATE POLICY "RTC v2 private topics write" ON realtime.messages
  FOR INSERT TO authenticated
  WITH CHECK (public.rtc_can_access_topic(realtime.topic()));