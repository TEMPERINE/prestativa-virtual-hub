
ALTER TABLE public.meetings
  ADD COLUMN recording_path text,
  ADD COLUMN recording_duration_seconds int,
  ADD COLUMN recorded_by uuid,
  ADD COLUMN recording_uploaded_at timestamptz;

-- Helper: participou da reunião?
CREATE OR REPLACE FUNCTION public.is_meeting_participant(_meeting_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.meeting_participants
    WHERE meeting_id = _meeting_id AND user_id = _user_id
  );
$$;
REVOKE EXECUTE ON FUNCTION public.is_meeting_participant(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_meeting_participant(uuid, uuid) TO authenticated;

-- Salva o resultado do upload (somente quem participou pode chamar)
CREATE OR REPLACE FUNCTION public.meeting_set_recording(
  _meeting_id uuid,
  _path text,
  _duration_seconds int
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
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
  WHERE id = _meeting_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.meeting_set_recording(uuid, text, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.meeting_set_recording(uuid, text, int) TO authenticated;

-- RLS no storage.objects para bucket meeting-recordings
-- Convenção de path: meeting-recordings/<meeting_id>/<file.webm>
CREATE POLICY "Participants read recording"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'meeting-recordings'
  AND public.is_meeting_participant(
    (string_to_array(name, '/'))[1]::uuid,
    auth.uid()
  )
);

CREATE POLICY "Participants upload recording"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'meeting-recordings'
  AND public.is_meeting_participant(
    (string_to_array(name, '/'))[1]::uuid,
    auth.uid()
  )
);
