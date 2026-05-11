-- Seed Group Leader accounts in authorized_users
--
-- Each leader has a unique initial passcode (change after go-live).
-- Passcodes are hashed with SHA-256 (lowercase hex), same as PRT login in the app.
--
-- ┌────────────────────────┬────────────────────┬─────────────────────┐
-- │ Name                   │ User ID            │ Initial passcode    │
-- ├────────────────────────┼────────────────────┼─────────────────────┤
-- │ Peter Marungu Mumbi    │ RFX-GL-MUMBI-001   │ pmumbi-24081        │
-- │ Joseph Githua          │ RFX-GL-GITHUA-001   │ jgithua-35192       │
-- │ Nicholas Katiku       │ RFX-GL-KATIKU-001   │ nkatiku-46203       │
-- │ Andrew Kihundu         │ RFX-GL-KIHUNDU-001  │ akihundu-57314      │
-- │ Johnstone Musyoka      │ RFX-GL-MUSYOKA-001  │ jmusyoka-68425      │
-- └────────────────────────┴────────────────────┴─────────────────────┘
--
-- Note: PRT create login still allows only role "Receiving Clerk". These accounts
--       supply the group-leader dropdown in PRT and can be used for future lead login.
--       assigned_zone is NULL.

INSERT INTO authorized_users (user_id, name, passcode_hash, role)
VALUES
  ('RFX-GL-MUMBI-001',  'Peter Marungu Mumbi', '3bf4f343c7e72a7075093b6528aacaf09f85a1a24434418fe0c58e6d7ee71290', 'Group Leader'),
  ('RFX-GL-GITHUA-001', 'Joseph Githua',       'b926851aeeeb29b88e1d0ba906101bc098e94ea5ca71a04e7c87bd237d367c2f', 'Group Leader'),
  ('RFX-GL-KATIKU-001', 'Nicholas Katiku',     '86f31cd556a21433e4d424cd80516512aea693405e55cd980cfdf149bde2a907', 'Group Leader'),
  ('RFX-GL-KIHUNDU-001','Andrew Kihundu',      '9854c55b7ca8c3fbd193bc89ed07f65849d05079edcf16cc1bb8fd9bfe091268', 'Group Leader'),
  ('RFX-GL-MUSYOKA-001','Johnstone Musyoka',   'e3c63cfbf3f1c89977eaf8044dc9360a03c7c0c2e2064fa6834e00be1c027145', 'Group Leader')
ON CONFLICT (user_id) DO UPDATE SET
  name = EXCLUDED.name,
  passcode_hash = EXCLUDED.passcode_hash,
  role = EXCLUDED.role,
  updated_at = now();
