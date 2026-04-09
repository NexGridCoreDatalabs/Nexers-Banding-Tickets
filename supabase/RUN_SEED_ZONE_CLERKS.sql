-- Seed Zone Clerk and Receiving Clerk users
-- Default passcode: 123456 (SHA-256 hex: 8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92)
-- Run after RUN_ADD_ASSIGNED_ZONE.sql

INSERT INTO authorized_users (user_id, name, passcode_hash, role, assigned_zone)
VALUES
  ('RFX-ZC-REC-001', 'Receiving Clerk 1', '8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92', 'Zone Clerk', 'Receiving Area'),
  ('RFX-ZC-DET-001', 'Detergents Zone Clerk', '8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92', 'Zone Clerk', 'Detergents Zone'),
  ('RFX-ZC-FAT-001', 'Fats Zone Clerk', '8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92', 'Zone Clerk', 'Fats Zone'),
  ('RFX-ZC-LIQ-001', 'Liquids Zone Clerk', '8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92', 'Zone Clerk', 'Liquids/Oils Zone'),
  ('RFX-ZC-SOP-001', 'Soaps Zone Clerk', '8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92', 'Zone Clerk', 'Soaps Zone'),
  ('RFX-ZC-FB-001',  'Foods & Beverages Clerk', '8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92', 'Zone Clerk', 'Foods & Beverages Zone'),
  ('RFX-ZC-SM-001', 'SuperMarket Clerk', '8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92', 'Zone Clerk', 'SuperMarket Area')
ON CONFLICT (user_id) DO UPDATE SET
  name = EXCLUDED.name,
  passcode_hash = EXCLUDED.passcode_hash,
  role = EXCLUDED.role,
  assigned_zone = EXCLUDED.assigned_zone,
  updated_at = now();
