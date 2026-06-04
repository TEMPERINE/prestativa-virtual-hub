
CREATE TABLE public.desk_notes (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  zone_id text NOT NULL,
  sender_id uuid NOT NULL,
  recipient_id uuid NOT NULL,
  body text NOT NULL,
  x real NOT NULL DEFAULT 0.5,
  y real NOT NULL DEFAULT 0.5,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz
);

CREATE INDEX desk_notes_recipient_idx ON public.desk_notes(recipient_id);
CREATE INDEX desk_notes_zone_idx ON public.desk_notes(zone_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.desk_notes TO authenticated;
GRANT ALL ON public.desk_notes TO service_role;

ALTER TABLE public.desk_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Desk notes readable by authenticated"
  ON public.desk_notes FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Senders create their own notes"
  ON public.desk_notes FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = sender_id AND sender_id <> recipient_id);

CREATE POLICY "Recipient updates own note"
  ON public.desk_notes FOR UPDATE
  TO authenticated USING (auth.uid() = recipient_id) WITH CHECK (auth.uid() = recipient_id);

CREATE POLICY "Recipient or sender deletes note"
  ON public.desk_notes FOR DELETE
  TO authenticated USING (auth.uid() = recipient_id OR auth.uid() = sender_id);

ALTER PUBLICATION supabase_realtime ADD TABLE public.desk_notes;
