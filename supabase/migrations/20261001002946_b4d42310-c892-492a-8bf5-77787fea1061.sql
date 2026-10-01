CREATE OR REPLACE FUNCTION public.meeting_access_status(_meeting_id uuid)
RETURNS TABLE(user_id uuid, kind text) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF NOT public.is_meeting_participant(_meeting_id, uid)
     AND NOT EXISTS (SELECT 1 FROM public.meeting_recording_shares s
                      WHERE s.meeting_id = _meeting_id AND s.recipient_id = uid) THEN
    RAISE EXCEPTION 'not allowed';
  END IF;
  RETURN QUERY
    SELECT DISTINCT p.user_id, 'participant'::text FROM public.meeting_participants p WHERE p.meeting_id = _meeting_id
    UNION
    SELECT s.recipient_id, 'shared'::text FROM public.meeting_recording_shares s
     WHERE s.meeting_id = _meeting_id
       AND NOT EXISTS (SELECT 1 FROM public.meeting_participants p2 WHERE p2.meeting_id = _meeting_id AND p2.user_id = s.recipient_id);
END $$;
REVOKE EXECUTE ON FUNCTION public.meeting_access_status(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.meeting_access_status(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.meeting_share_recording_batch(_meeting_id uuid, _recipient_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  m_ws uuid;
  m_path text;
  has_rec boolean;
  r uuid;
  batch uuid := gen_random_uuid();
  created uuid[] := '{}';
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _recipient_ids IS NULL OR array_length(_recipient_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'no recipients';
  END IF;
  IF array_length(_recipient_ids, 1) > 200 THEN RAISE EXCEPTION 'too many recipients'; END IF;

  SELECT workspace_id, recording_path INTO m_ws, m_path FROM public.meetings WHERE id = _meeting_id;
  IF m_ws IS NULL THEN RAISE EXCEPTION 'meeting not found'; END IF;
  has_rec := m_path IS NOT NULL OR EXISTS (
    SELECT 1 FROM public.meeting_egress e WHERE e.meeting_id = _meeting_id AND e.status = 'complete');
  IF NOT has_rec THEN RAISE EXCEPTION 'meeting has no recording'; END IF;

  IF NOT public.is_meeting_participant(_meeting_id, uid)
     AND NOT EXISTS (SELECT 1 FROM public.meeting_recording_shares
                      WHERE meeting_id = _meeting_id AND recipient_id = uid) THEN
    RAISE EXCEPTION 'not allowed to share this recording';
  END IF;

  FOREACH r IN ARRAY _recipient_ids LOOP
    IF r = uid THEN RAISE EXCEPTION 'cannot share with yourself'; END IF;
    IF NOT public.is_workspace_member(m_ws, r) THEN RAISE EXCEPTION 'recipient is not a workspace member'; END IF;
  END LOOP;

  -- Quem participou ou já recebeu nunca ganha novo registro (nem entra no lote de undo).
  WITH ins AS (
    INSERT INTO public.meeting_recording_shares (meeting_id, sender_id, recipient_id, share_batch_id)
    SELECT _meeting_id, uid, d.x, batch
      FROM (SELECT DISTINCT unnest(_recipient_ids) AS x) d
     WHERE NOT EXISTS (SELECT 1 FROM public.meeting_participants p WHERE p.meeting_id = _meeting_id AND p.user_id = d.x)
    ON CONFLICT (meeting_id, recipient_id) DO NOTHING
    RETURNING recipient_id
  ) SELECT coalesce(array_agg(recipient_id), '{}') INTO created FROM ins;

  RETURN jsonb_build_object('batch_id', batch, 'created', to_jsonb(created));
END $$;