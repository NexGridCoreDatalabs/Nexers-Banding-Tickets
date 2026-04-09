-- Run in Supabase SQL Editor to verify Zone Clerks and Receiving Clerks exist
SELECT user_id, name, role, assigned_zone
FROM authorized_users
WHERE role IN ('Zone Clerk', 'Receiving Clerk')
ORDER BY role, user_id;
