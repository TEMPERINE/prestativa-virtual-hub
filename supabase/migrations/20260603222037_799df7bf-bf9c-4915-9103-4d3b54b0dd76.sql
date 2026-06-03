
-- Tighten SECURITY DEFINER functions
ALTER FUNCTION public.has_role(uuid, public.app_role) SET search_path = public;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;

ALTER FUNCTION public.handle_new_user() SET search_path = public;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM public, anon, authenticated;

ALTER FUNCTION public.touch_updated_at() SET search_path = public;
REVOKE EXECUTE ON FUNCTION public.touch_updated_at() FROM public, anon, authenticated;
