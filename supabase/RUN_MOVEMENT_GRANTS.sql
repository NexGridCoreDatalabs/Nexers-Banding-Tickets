-- Run this in Supabase SQL Editor if you already ran RUN_MOVEMENT_SUPABASE.sql
-- and the Stock Movement page shows "permission denied" when initiating/receiving.
-- This grants the anon role permission to call the movement RPCs.

GRANT EXECUTE ON FUNCTION movement_initiate(text, text, text, text, text, numeric, text) TO anon;
GRANT EXECUTE ON FUNCTION movement_receive(text, text) TO anon;
-- After RUN_FORKLIFT_SOFT_DISPATCH.sql:
-- GRANT EXECUTE ON FUNCTION enqueue_forklift_staging_intent(text, text, text, int, text, text) TO anon;
