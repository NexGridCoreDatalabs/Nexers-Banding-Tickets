-- Verify export passcode server-side to avoid client-side access to passcode_hash.

CREATE OR REPLACE FUNCTION verify_export_passcode(
  p_actor_user_id text,
  p_passcode_hash text
)
RETURNS TABLE (ok boolean)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_actor_norm text;
BEGIN
  v_actor_norm := regexp_replace(upper(trim(coalesce(p_actor_user_id, ''))), '[^A-Z0-9]', '', 'g');

  RETURN QUERY
  SELECT EXISTS (
    SELECT 1
    FROM authorized_users au
    WHERE regexp_replace(upper(coalesce(au.user_id, '')), '[^A-Z0-9]', '', 'g') = v_actor_norm
      AND lower(trim(coalesce(au.passcode_hash, ''))) = lower(trim(coalesce(p_passcode_hash, '')))
  );
END;
$$;

