-- PRT workforce roster (official names) + shift team assignments with exclusivity:
-- one workforce member may appear on only ONE group leader's team per shift_start_iso.

CREATE TABLE IF NOT EXISTS prt_workforce_roster (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT prt_workforce_roster_display_name_key UNIQUE (display_name)
);

CREATE INDEX IF NOT EXISTS prt_workforce_roster_active_idx
  ON prt_workforce_roster (is_active) WHERE is_active = true;

COMMENT ON TABLE prt_workforce_roster IS 'Official production workforce names; GLs pick team only from this list.';

CREATE TABLE IF NOT EXISTS gl_shift_team_member (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_start_iso timestamptz NOT NULL,
  group_leader_user_id text NOT NULL,
  group_leader_name text NOT NULL,
  workforce_id uuid NOT NULL REFERENCES prt_workforce_roster(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gl_shift_team_member_one_team_per_person_per_shift UNIQUE (shift_start_iso, workforce_id)
);

CREATE INDEX IF NOT EXISTS gl_shift_team_member_shift_leader_idx
  ON gl_shift_team_member (shift_start_iso, group_leader_user_id);

COMMENT ON TABLE gl_shift_team_member IS 'Group leader team for a shift; UNIQUE(shift, workforce_id) blocks same person on two teams same shift.';

ALTER TABLE prt_workforce_roster ENABLE ROW LEVEL SECURITY;
ALTER TABLE gl_shift_team_member ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "prt_workforce_roster_anon_select" ON prt_workforce_roster;
CREATE POLICY "prt_workforce_roster_anon_select" ON prt_workforce_roster FOR SELECT TO anon USING (true);
DROP POLICY IF EXISTS "prt_workforce_roster_anon_insert" ON prt_workforce_roster;
CREATE POLICY "prt_workforce_roster_anon_insert" ON prt_workforce_roster FOR INSERT TO anon WITH CHECK (true);
DROP POLICY IF EXISTS "prt_workforce_roster_anon_update" ON prt_workforce_roster;
CREATE POLICY "prt_workforce_roster_anon_update" ON prt_workforce_roster FOR UPDATE TO anon USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "gl_shift_team_member_anon_select" ON gl_shift_team_member;
CREATE POLICY "gl_shift_team_member_anon_select" ON gl_shift_team_member FOR SELECT TO anon USING (true);
DROP POLICY IF EXISTS "gl_shift_team_member_anon_insert" ON gl_shift_team_member;
CREATE POLICY "gl_shift_team_member_anon_insert" ON gl_shift_team_member FOR INSERT TO anon WITH CHECK (true);
DROP POLICY IF EXISTS "gl_shift_team_member_anon_update" ON gl_shift_team_member;
CREATE POLICY "gl_shift_team_member_anon_update" ON gl_shift_team_member FOR UPDATE TO anon USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "gl_shift_team_member_anon_delete" ON gl_shift_team_member;
CREATE POLICY "gl_shift_team_member_anon_delete" ON gl_shift_team_member FOR DELETE TO anon USING (true);
