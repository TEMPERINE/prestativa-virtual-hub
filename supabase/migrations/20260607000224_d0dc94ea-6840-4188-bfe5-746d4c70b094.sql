
ALTER TABLE public.meetings
  ADD COLUMN IF NOT EXISTS recording_started_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.meeting_mark_recording_started(_meeting_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF NOT public.is_meeting_participant(_meeting_id, uid) THEN
    RAISE EXCEPTION 'not a participant';
  END IF;
  UPDATE public.meetings
  SET recording_started_at = COALESCE(recording_started_at, now()),
      recorded_by = COALESCE(recorded_by, uid)
  WHERE id = _meeting_id;
END;
$$;
