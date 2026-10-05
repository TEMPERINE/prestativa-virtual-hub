CREATE OR REPLACE FUNCTION public.rtc_can_access_topic(_topic text)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE uid uuid := auth.uid(); parts text[];
BEGIN
  IF uid IS NULL OR _topic IS NULL THEN RETURN false; END IF;
  parts := string_to_array(_topic, ':');
  IF array_length(parts, 1) <> 3 THEN RETURN false; END IF;
  IF parts[1] = 'workspace' AND parts[3] IN ('presence','movement','map','meeting-idle')
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