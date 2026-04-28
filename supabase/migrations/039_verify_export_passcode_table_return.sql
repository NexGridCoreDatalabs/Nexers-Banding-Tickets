-- PostgREST reliably exposes SET-returning RPCs as JSON arrays.
-- Force-drop any scalar vs table overload ambiguity, then one canonical TABLE shape.

DROP FUNCTION IF EXISTS public.verify_export_passcode(text, text);

CREATE OR REPLACE FUNCTION public.verify_export_passcode(
  p_actor_user_id text,
  p_passcode_hash text
)
RETURNS TABLE (ok boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_norm text;
BEGIN
  v_actor_norm := regexp_replace(upper(trim(coalesce(p_actor_user_id, ''))), '[^A-Z0-9]', '', 'g');

  RETURN QUERY
  SELECT EXISTS (
    SELECT 1
    FROM public.authorized_users au
    WHERE au.is_active = true
      AND regexp_replace(upper(coalesce(au.user_id, '')), '[^A-Z0-9]', '', 'g') = v_actor_norm
      AND lower(trim(coalesce(au.passcode_hash, ''))) = lower(trim(coalesce(p_passcode_hash, '')))
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.verify_export_passcode(text, text) TO anon, authenticated, service_role;
