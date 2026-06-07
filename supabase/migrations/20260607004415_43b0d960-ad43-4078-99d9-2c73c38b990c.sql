
-- 1) Backfill participants when recording starts
CREATE OR REPLACE FUNCTION public.meeting_mark_recording_started(_meeting_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid := auth.uid();
  m_zone text;
  m_ws uuid;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF NOT public.is_meeting_participant(_meeting_id, uid) THEN
    RAISE EXCEPTION 'not a participant';
  END IF;
  UPDATE public.meetings
  SET recording_started_at = COALESCE(recording_started_at, now()),
      recorded_by = COALESCE(recorded_by, uid)
  WHERE id = _meeting_id
  RETURNING zone_id, workspace_id INTO m_zone, m_ws;

  -- adiciona como participantes todos que estão online na mesma sala/workspace
  IF m_zone IS NOT NULL AND m_ws IS NOT NULL THEN
    INSERT INTO public.meeting_participants (meeting_id, user_id)
    SELECT _meeting_id, p.user_id
      FROM public.positions p
     WHERE p.zone = m_zone
       AND p.workspace_id = m_ws
       AND p.is_online = true
       AND NOT EXISTS (
         SELECT 1 FROM public.meeting_participants mp
          WHERE mp.meeting_id = _meeting_id AND mp.user_id = p.user_id
       );
  END IF;
END;
$function$;

-- 2) Sharing table
CREATE TABLE public.meeting_recording_shares (
  meeting_id uuid NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL,
  recipient_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (meeting_id, recipient_id)
);

GRANT SELECT, INSERT, DELETE ON public.meeting_recording_shares TO authenticated;
GRANT ALL ON public.meeting_recording_shares TO service_role;

ALTER TABLE public.meeting_recording_shares ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Recipient or sender reads share"
  ON public.meeting_recording_shares FOR SELECT TO authenticated
  USING (auth.uid() = recipient_id OR auth.uid() = sender_id);

CREATE POLICY "Recipient or sender deletes share"
  ON public.meeting_recording_shares FOR DELETE TO authenticated
  USING (auth.uid() = recipient_id OR auth.uid() = sender_id);

-- inserts happen via SECURITY DEFINER RPC; no INSERT policy needed for clients

CREATE INDEX meeting_recording_shares_recipient_idx
  ON public.meeting_recording_shares (recipient_id);

-- 3) Allow recipients to read the shared meeting
DROP POLICY IF EXISTS "Members read workspace meetings" ON public.meetings;
CREATE POLICY "Members or recipients read meetings"
  ON public.meetings FOR SELECT TO authenticated
  USING (
    (is_workspace_member(workspace_id, auth.uid())
     AND EXISTS (SELECT 1 FROM public.meeting_participants mp
                  WHERE mp.meeting_id = meetings.id AND mp.user_id = auth.uid()))
    OR EXISTS (SELECT 1 FROM public.meeting_recording_shares s
                WHERE s.meeting_id = meetings.id AND s.recipient_id = auth.uid())
  );

-- 4) Share RPC
CREATE OR REPLACE FUNCTION public.meeting_share_recording(_meeting_id uuid, _recipient_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid := auth.uid();
  m_ws uuid;
  m_path text;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF uid = _recipient_id THEN RAISE EXCEPTION 'cannot share with yourself'; END IF;

  SELECT workspace_id, recording_path INTO m_ws, m_path
    FROM public.meetings WHERE id = _meeting_id;
  IF m_ws IS NULL THEN RAISE EXCEPTION 'meeting not found'; END IF;
  IF m_path IS NULL THEN RAISE EXCEPTION 'meeting has no recording'; END IF;

  -- sender must be a participant or already a recipient
  IF NOT public.is_meeting_participant(_meeting_id, uid)
     AND NOT EXISTS (SELECT 1 FROM public.meeting_recording_shares
                      WHERE meeting_id = _meeting_id AND recipient_id = uid) THEN
    RAISE EXCEPTION 'not allowed to share this recording';
  END IF;

  -- recipient must be a member of the workspace
  IF NOT public.is_workspace_member(m_ws, _recipient_id) THEN
    RAISE EXCEPTION 'recipient is not a workspace member';
  END IF;

  INSERT INTO public.meeting_recording_shares (meeting_id, sender_id, recipient_id)
  VALUES (_meeting_id, uid, _recipient_id)
  ON CONFLICT (meeting_id, recipient_id) DO NOTHING;
END;
$function$;
