CREATE TABLE public.meeting_egress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id uuid NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL,
  room_name text NOT NULL,
  egress_id text UNIQUE,
  status text NOT NULL DEFAULT 'starting' CHECK (status IN ('starting','active','ending','complete','failed')),
  started_by uuid NOT NULL,
  stopped_by uuid,
  file_path text,
  file_size bigint,
  duration_seconds integer,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  ended_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.meeting_egress TO authenticated;
GRANT ALL ON public.meeting_egress TO service_role;
ALTER TABLE public.meeting_egress ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Participants read meeting egress" ON public.meeting_egress
  FOR SELECT TO authenticated
  USING (public.is_meeting_participant(meeting_id, auth.uid()) OR public.is_workspace_admin(workspace_id, auth.uid()));
-- Impede duas gravações simultâneas da mesma reunião
CREATE UNIQUE INDEX meeting_egress_one_active ON public.meeting_egress (meeting_id)
  WHERE status IN ('starting','active','ending');
CREATE TRIGGER meeting_egress_touch BEFORE UPDATE ON public.meeting_egress
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
ALTER PUBLICATION supabase_realtime ADD TABLE public.meeting_egress;