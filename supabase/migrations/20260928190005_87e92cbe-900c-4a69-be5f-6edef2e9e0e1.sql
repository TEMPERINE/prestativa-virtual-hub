REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.office_sessions FROM authenticated, anon;
REVOKE UPDATE, DELETE, TRUNCATE ON public.rtc_events FROM authenticated, anon;
REVOKE ALL ON public.office_sessions FROM anon;
REVOKE ALL ON public.rtc_events FROM anon;