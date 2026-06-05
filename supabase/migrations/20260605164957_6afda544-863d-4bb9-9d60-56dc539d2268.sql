
CREATE TABLE public.prop_states (
  prop_id text PRIMARY KEY,
  frame int NOT NULL DEFAULT 0,
  updated_by uuid REFERENCES auth.users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.prop_states TO authenticated;
GRANT ALL ON public.prop_states TO service_role;
ALTER TABLE public.prop_states ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Prop states readable" ON public.prop_states FOR SELECT TO authenticated USING (true);
CREATE POLICY "Prop states insert" ON public.prop_states FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Prop states update" ON public.prop_states FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
ALTER PUBLICATION supabase_realtime ADD TABLE public.prop_states;
