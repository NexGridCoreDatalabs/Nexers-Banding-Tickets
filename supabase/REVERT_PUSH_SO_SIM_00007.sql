-- Revert push for order SO-SIM-00007 so Irene can complete SM-ORD-00012
-- Run in Supabase SQL Editor, then:
-- 1. Irene logs into Picker Portal → Order will now appear (AWAITING_SM_RELEASE)
-- 2. She opens the order, selects SM-ORD-00012, clicks "✓ Complete pallet"
-- 3. Zone clerk releases SM-ORD-00012, then order can be pushed again

UPDATE orders 
SET pushed_to_dispatch_at = NULL, 
    pushed_to_dispatch_by = NULL 
WHERE external_order_no = 'SO-SIM-00007';
