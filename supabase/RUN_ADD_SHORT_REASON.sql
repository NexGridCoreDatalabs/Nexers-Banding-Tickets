-- Run this before pickers can mark short with reason
ALTER TABLE order_lines ADD COLUMN IF NOT EXISTS short_reason text;
