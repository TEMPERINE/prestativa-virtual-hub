
CREATE TABLE public.saved_notes (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  sender_id uuid NOT NULL,
  sender_name text,
  body text NOT NULL,
  original_created_at timestamptz NOT NULL,
  saved_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, DELETE ON public.saved_notes TO authenticated;
GRANT ALL ON public.saved_notes TO service_role;
ALTER TABLE public.saved_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owner reads own saved notes" ON public.saved_notes
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Owner inserts own saved notes" ON public.saved_notes
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Owner deletes own saved notes" ON public.saved_notes
  FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE INDEX saved_notes_user_saved_at_idx ON public.saved_notes (user_id, saved_at DESC);
