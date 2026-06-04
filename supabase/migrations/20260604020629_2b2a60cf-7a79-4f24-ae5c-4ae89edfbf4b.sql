
CREATE TABLE public.workspace_claims (
  zone_id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  claimed_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX workspace_claims_user_id_unique ON public.workspace_claims(user_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workspace_claims TO authenticated;
GRANT ALL ON public.workspace_claims TO service_role;
ALTER TABLE public.workspace_claims ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Claims readable by authenticated" ON public.workspace_claims FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users insert own claim" ON public.workspace_claims FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own claim" ON public.workspace_claims FOR DELETE TO authenticated USING (auth.uid() = user_id);
ALTER PUBLICATION supabase_realtime ADD TABLE public.workspace_claims;
