
-- Tabelas
CREATE TABLE public.meetings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  zone_id text NOT NULL,
  zone_label text NOT NULL,
  title text,
  host_id uuid,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz
);
CREATE INDEX meetings_active_by_zone_idx ON public.meetings(zone_id) WHERE ended_at IS NULL;
CREATE INDEX meetings_started_at_idx ON public.meetings(started_at DESC);

CREATE TABLE public.meeting_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id uuid NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  joined_at timestamptz NOT NULL DEFAULT now(),
  left_at timestamptz
);
CREATE INDEX mp_meeting_idx ON public.meeting_participants(meeting_id);
CREATE INDEX mp_user_idx ON public.meeting_participants(user_id);
CREATE INDEX mp_active_idx ON public.meeting_participants(meeting_id) WHERE left_at IS NULL;

-- Grants
GRANT SELECT ON public.meetings TO authenticated;
GRANT ALL ON public.meetings TO service_role;
GRANT SELECT ON public.meeting_participants TO authenticated;
GRANT ALL ON public.meeting_participants TO service_role;

-- RLS
ALTER TABLE public.meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_participants ENABLE ROW LEVEL SECURITY;

-- Só vê reuniões em que participou
CREATE POLICY "User reads meetings they joined"
ON public.meetings FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.meeting_participants mp
    WHERE mp.meeting_id = meetings.id AND mp.user_id = auth.uid()
  )
);

-- Só vê os próprios registros de participação
CREATE POLICY "User reads own participation"
ON public.meeting_participants FOR SELECT TO authenticated
USING (user_id = auth.uid());

-- Função: entrar (ou criar) reunião ativa na zona
CREATE OR REPLACE FUNCTION public.meeting_join(_zone_id text, _zone_label text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  active_meeting uuid;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  -- Pega reunião ativa nessa zona (criada nos últimos 6h, sem ended_at)
  SELECT id INTO active_meeting
  FROM public.meetings
  WHERE zone_id = _zone_id
    AND ended_at IS NULL
    AND started_at > now() - interval '6 hours'
  ORDER BY started_at DESC
  LIMIT 1;

  -- Se não existir, cria uma nova
  IF active_meeting IS NULL THEN
    INSERT INTO public.meetings (zone_id, zone_label, host_id)
    VALUES (_zone_id, _zone_label, uid)
    RETURNING id INTO active_meeting;
  END IF;

  -- Registra entrada (se não houver participação ativa do mesmo usuário)
  IF NOT EXISTS (
    SELECT 1 FROM public.meeting_participants
    WHERE meeting_id = active_meeting AND user_id = uid AND left_at IS NULL
  ) THEN
    INSERT INTO public.meeting_participants (meeting_id, user_id)
    VALUES (active_meeting, uid);
  END IF;

  RETURN active_meeting;
END;
$$;

-- Função: sair da reunião; se ficou vazia, encerra
CREATE OR REPLACE FUNCTION public.meeting_leave(_meeting_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  active_count int;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  UPDATE public.meeting_participants
  SET left_at = now()
  WHERE meeting_id = _meeting_id AND user_id = uid AND left_at IS NULL;

  SELECT count(*) INTO active_count
  FROM public.meeting_participants
  WHERE meeting_id = _meeting_id AND left_at IS NULL;

  IF active_count = 0 THEN
    UPDATE public.meetings
    SET ended_at = now()
    WHERE id = _meeting_id AND ended_at IS NULL;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.meeting_join(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.meeting_leave(uuid) TO authenticated;
