-- Picker reports short → supervisor confirms or clears
ALTER TABLE order_lines ADD COLUMN IF NOT EXISTS picker_reported_by text;
ALTER TABLE order_lines ADD COLUMN IF NOT EXISTS picker_reported_at timestamptz;
