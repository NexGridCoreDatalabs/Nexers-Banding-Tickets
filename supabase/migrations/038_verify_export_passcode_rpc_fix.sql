-- Fix passcode verification RPC signature and permissions for Supabase REST RPC calls.

DROP FUNCTION IF EXISTS verify_export_passcode(text, text);

CREATE OR REPLACE FUNCTION verify_export_passcode(
  p_actor_user_id text,
  p_passcode_hash text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_norm text;
BEGIN
  v_actor_norm := regexp_replace(upper(trim(coalesce(p_actor_user_id, ''))), '[^A-Z0-9]', '', 'g');

  RETURN EXISTS (
    SELECT 1
    FROM authorized_users au
    WHERE au.is_active = true
      AND regexp_replace(upper(coalesce(au.user_id, '')), '[^A-Z0-9]', '', 'g') = v_actor_norm
      AND lower(trim(coalesce(au.passcode_hash, ''))) = lower(trim(coalesce(p_passcode_hash, '')))
  );
END;
$$;

GRANT EXECUTE ON FUNCTION verify_export_passcode(text, text) TO anon, authenticated, service_role;

