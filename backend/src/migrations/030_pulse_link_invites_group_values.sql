ALTER TABLE pulse_link_invites
  ADD COLUMN IF NOT EXISTS group_level_values JSONB NOT NULL DEFAULT '[]'::jsonb;
