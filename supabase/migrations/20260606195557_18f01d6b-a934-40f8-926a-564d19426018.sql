
CREATE TABLE public.meeting_folders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX meeting_folders_user_idx ON public.meeting_folders(user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.meeting_folders TO authenticated;
GRANT ALL ON public.meeting_folders TO service_role;

ALTER TABLE public.meeting_folders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner reads own folders" ON public.meeting_folders
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Owner inserts own folders" ON public.meeting_folders
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Owner updates own folders" ON public.meeting_folders
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Owner deletes own folders" ON public.meeting_folders
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TRIGGER meeting_folders_touch
  BEFORE UPDATE ON public.meeting_folders
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.meeting_folder_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  folder_id uuid NOT NULL REFERENCES public.meeting_folders(id) ON DELETE CASCADE,
  meeting_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, folder_id, meeting_id)
);
CREATE INDEX meeting_folder_items_user_idx ON public.meeting_folder_items(user_id);
CREATE INDEX meeting_folder_items_meeting_idx ON public.meeting_folder_items(meeting_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.meeting_folder_items TO authenticated;
GRANT ALL ON public.meeting_folder_items TO service_role;

ALTER TABLE public.meeting_folder_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner reads own folder items" ON public.meeting_folder_items
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Owner inserts own folder items" ON public.meeting_folder_items
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Owner deletes own folder items" ON public.meeting_folder_items
  FOR DELETE TO authenticated USING (auth.uid() = user_id);
