
CREATE OR REPLACE FUNCTION public.meeting_set_recording(_meeting_id uuid, _path text, _duration_seconds integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid := auth.uid();
  m_zone text;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF NOT public.is_meeting_participant(_meeting_id, uid) THEN
    RAISE EXCEPTION 'not a participant';
  END IF;

  UPDATE public.meetings
  SET recording_path = _path,
      recording_duration_seconds = _duration_seconds,
      recorded_by = uid,
      recording_uploaded_at = now()
  WHERE id = _meeting_id
  RETURNING zone_id INTO m_zone;

  -- Rede de segurança: inclui como participantes todos que estão online
  -- nessa zona agora (caso meeting_join ainda não tenha registrado por
  -- debounce/timing). Só insere se ainda não houver participação ativa.
  IF m_zone IS NOT NULL THEN
    INSERT INTO public.meeting_participants (meeting_id, user_id)
    SELECT _meeting_id, p.user_id
    FROM public.positions p
    WHERE p.zone = m_zone
      AND p.is_online = true
      AND NOT EXISTS (
        SELECT 1 FROM public.meeting_participants mp
        WHERE mp.meeting_id = _meeting_id AND mp.user_id = p.user_id
      );
  END IF;
END;
$function$;
