ALTER TABLE public.meeting_recording_shares ADD COLUMN IF NOT EXISTS share_batch_id uuid;

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

  -- mesma regra atual: participante ou quem já recebeu
  IF NOT public.is_meeting_participant(_meeting_id, uid)
     AND NOT EXISTS (SELECT 1 FROM public.meeting_recording_shares
                      WHERE meeting_id = _meeting_id AND recipient_id = uid) THEN
    RAISE EXCEPTION 'not allowed to share this recording';
  END IF;

  -- valida todos antes de gravar qualquer coisa (tudo ou nada)
  FOREACH r IN ARRAY _recipient_ids LOOP
    IF r = uid THEN RAISE EXCEPTION 'cannot share with yourself'; END IF;
    IF NOT public.is_workspace_member(m_ws, r) THEN RAISE EXCEPTION 'recipient is not a workspace member'; END IF;
  END LOOP;

  WITH ins AS (
    INSERT INTO public.meeting_recording_shares (meeting_id, sender_id, recipient_id, share_batch_id)
    SELECT _meeting_id, uid, x, batch FROM (SELECT DISTINCT unnest(_recipient_ids) AS x) d
    ON CONFLICT (meeting_id, recipient_id) DO NOTHING
    RETURNING recipient_id
  ) SELECT coalesce(array_agg(recipient_id), '{}') INTO created FROM ins;

  RETURN jsonb_build_object('batch_id', batch, 'created', to_jsonb(created));
END $$;

CREATE OR REPLACE FUNCTION public.meeting_undo_share_batch(_meeting_id uuid, _batch_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  DELETE FROM public.meeting_recording_shares
   WHERE meeting_id = _meeting_id AND share_batch_id = _batch_id AND sender_id = auth.uid();
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

REVOKE EXECUTE ON FUNCTION public.meeting_share_recording_batch(uuid, uuid[]) FROM public, anon;
REVOKE EXECUTE ON FUNCTION public.meeting_undo_share_batch(uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.meeting_share_recording_batch(uuid, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.meeting_undo_share_batch(uuid, uuid) TO authenticated;