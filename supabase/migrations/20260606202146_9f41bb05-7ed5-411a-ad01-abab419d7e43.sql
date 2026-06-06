
-- Tabela de favoritos por usuário (organização pessoal, como pastas)
CREATE TABLE public.meeting_favorites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  meeting_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, meeting_id)
);

GRANT SELECT, INSERT, DELETE ON public.meeting_favorites TO authenticated;
GRANT ALL ON public.meeting_favorites TO service_role;

ALTER TABLE public.meeting_favorites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner reads own favorites" ON public.meeting_favorites
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Owner inserts own favorites" ON public.meeting_favorites
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Owner deletes own favorites" ON public.meeting_favorites
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- RPC para renomear título (participante pode renomear; afeta todos os participantes)
CREATE OR REPLACE FUNCTION public.meeting_set_title(_meeting_id uuid, _title text)
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
  UPDATE public.meetings SET title = NULLIF(btrim(_title), '') WHERE id = _meeting_id;
END;
$$;
