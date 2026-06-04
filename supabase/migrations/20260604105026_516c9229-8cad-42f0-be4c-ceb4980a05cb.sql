CREATE TABLE public.map_overrides (
  id text PRIMARY KEY,
  data jsonb NOT NULL,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.map_overrides TO authenticated;
GRANT ALL ON public.map_overrides TO service_role;

ALTER TABLE public.map_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Map readable by authenticated"
  ON public.map_overrides FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins and supervisors can insert map"
  ON public.map_overrides FOR INSERT
  TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'supervisor')
  );

CREATE POLICY "Admins and supervisors can update map"
  ON public.map_overrides FOR UPDATE
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'supervisor')
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'supervisor')
  );

CREATE POLICY "Admins and supervisors can delete map"
  ON public.map_overrides FOR DELETE
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'supervisor')
  );

ALTER PUBLICATION supabase_realtime ADD TABLE public.map_overrides;