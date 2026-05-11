-- Group leader: names of team members on shift (one roster row per leader per shift window).
-- shift_start_iso matches the PRT / GL session boundary (EAT day + day-night shift).

CREATE TABLE IF NOT EXISTS gl_shift_team_roster (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_leader_user_id text NOT NULL,
  group_leader_name text NOT NULL,
  shift_start_iso timestamptz NOT NULL,
  team_member_names text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (group_leader_user_id, shift_start_iso)
);

CREATE INDEX IF NOT EXISTS gl_shift_team_roster_leader_shift_idx
  ON gl_shift_team_roster (group_leader_user_id, shift_start_iso DESC);

COMMENT ON TABLE gl_shift_team_roster IS
  'Team member names (free text, one per line) declared by group leader for a shift; tied to same shift_start as PRT/GL UI.';

ALTER TABLE gl_shift_team_roster ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "gl_shift_team_roster_anon_select" ON gl_shift_team_roster;
CREATE POLICY "gl_shift_team_roster_anon_select" ON gl_shift_team_roster FOR SELECT TO anon USING (true);
DROP POLICY IF EXISTS "gl_shift_team_roster_anon_insert" ON gl_shift_team_roster;
CREATE POLICY "gl_shift_team_roster_anon_insert" ON gl_shift_team_roster FOR INSERT TO anon WITH CHECK (true);
DROP POLICY IF EXISTS "gl_shift_team_roster_anon_update" ON gl_shift_team_roster;
CREATE POLICY "gl_shift_team_roster_anon_update" ON gl_shift_team_roster FOR UPDATE TO anon USING (true) WITH CHECK (true);
