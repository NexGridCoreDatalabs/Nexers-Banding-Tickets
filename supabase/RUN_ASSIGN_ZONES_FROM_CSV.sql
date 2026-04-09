-- Assign zones to existing Zone Clerks and Receiving Clerks (from authorized_users_rows.csv)
-- Run after RUN_ADD_ASSIGNED_ZONE.sql
-- Adjust zone assignments as needed for your warehouse layout

-- Zone Clerks (product zones + SuperMarket + Dispatch)
UPDATE authorized_users SET assigned_zone = 'Detergents Zone'         WHERE user_id = 'RFX-ZCK-AW-001' AND role = 'Zone Clerk';
UPDATE authorized_users SET assigned_zone = 'Fats Zone'                WHERE user_id = 'RFX-ZCK-BO-002' AND role = 'Zone Clerk';
UPDATE authorized_users SET assigned_zone = 'Liquids/Oils Zone'        WHERE user_id = 'RFX-ZCK-CA-003' AND role = 'Zone Clerk';
UPDATE authorized_users SET assigned_zone = 'Soaps Zone'              WHERE user_id = 'RFX-ZCK-DK-004' AND role = 'Zone Clerk';
UPDATE authorized_users SET assigned_zone = 'Foods & Beverages Zone'  WHERE user_id = 'RFX-ZCK-EC-005' AND role = 'Zone Clerk';
UPDATE authorized_users SET assigned_zone = 'SuperMarket Area'        WHERE user_id = 'RFX-ZCK-FM-006' AND role = 'Zone Clerk';
UPDATE authorized_users SET assigned_zone = 'SuperMarket Area'        WHERE user_id = 'RFX-ZCK-GN-007' AND role = 'Zone Clerk';
UPDATE authorized_users SET assigned_zone = 'Dispatch Loading Area'    WHERE user_id = 'RFX-ZCK-HO-008' AND role = 'Zone Clerk';

-- Receiving Clerks
UPDATE authorized_users SET assigned_zone = 'Receiving Area'          WHERE user_id = 'RFX-RCV-WK-001' AND role = 'Receiving Clerk';
UPDATE authorized_users SET assigned_zone = 'Receiving Area'          WHERE user_id = 'RFX-RCV-YN-002' AND role = 'Receiving Clerk';
