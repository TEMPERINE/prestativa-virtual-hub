
ALTER TABLE public.meetings
  ADD COLUMN IF NOT EXISTS transcript text,
  ADD COLUMN IF NOT EXISTS summary text,
  ADD COLUMN IF NOT EXISTS ai_status text NOT NULL DEFAULT 'idle',
  ADD COLUMN IF NOT EXISTS ai_error text,
  ADD COLUMN IF NOT EXISTS ai_generated_at timestamp with time zone;

CREATE OR REPLACE FUNCTION public.meeting_mark_ai_processing(_meeting_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF NOT public.is_meeting_participant(_meeting_id, uid) THEN
    RAISE EXCEPTION 'not a participant';
  END IF;
  UPDATE public.meetings
  SET ai_status = 'processing', ai_error = NULL
  WHERE id = _meeting_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.meeting_set_ai_result(
  _meeting_id uuid,
  _transcript text,
  _summary text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.meetings
  SET transcript = _transcript,
      summary = _summary,
      ai_status = 'done',
      ai_error = NULL,
      ai_generated_at = now()
  WHERE id = _meeting_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.meeting_set_ai_error(
  _meeting_id uuid,
  _error text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.meetings
  SET ai_status = 'error', ai_error = _error
  WHERE id = _meeting_id;
END;
$$;
