-- Add short_reason to order_lines: required when picker marks a line as SHORT
ALTER TABLE order_lines ADD COLUMN IF NOT EXISTS short_reason text;
