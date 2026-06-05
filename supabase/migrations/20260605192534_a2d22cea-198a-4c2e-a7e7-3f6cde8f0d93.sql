CREATE TABLE public.custom_props (
  id text PRIMARY KEY,
  label text NOT NULL,
  frames jsonb NOT NULL,
  default_w real NOT NULL DEFAULT 0.08,
  aspect_ratio real NOT NULL DEFAULT 1,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.custom_props TO authenticated;
GRANT ALL ON public.custom_props TO service_role;
ALTER TABLE public.custom_props ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Custom props readable by authenticated" ON public.custom_props FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins/supervisors insert custom props" ON public.custom_props FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'supervisor'));
CREATE POLICY "Admins/supervisors update custom props" ON public.custom_props FOR UPDATE TO authenticated USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'supervisor')) WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'supervisor'));
CREATE POLICY "Admins/supervisors delete custom props" ON public.custom_props FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'supervisor'));