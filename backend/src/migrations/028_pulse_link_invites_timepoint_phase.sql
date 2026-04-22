ALTER TABLE pulse_link_invites
  ADD COLUMN IF NOT EXISTS timepoint_phase TEXT;

UPDATE pulse_link_invites
SET timepoint_phase = 'pre'
WHERE timepoint_phase IS NULL;

ALTER TABLE pulse_link_invites
  ALTER COLUMN timepoint_phase SET DEFAULT 'pre';

ALTER TABLE pulse_link_invites
  ALTER COLUMN timepoint_phase SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'pulse_link_invites_timepoint_phase_check'
  ) THEN
    ALTER TABLE pulse_link_invites
      ADD CONSTRAINT pulse_link_invites_timepoint_phase_check
      CHECK (timepoint_phase IN ('pre', 'during', 'completed'));
  END IF;
END $$;

DROP INDEX IF EXISTS idx_pulse_link_invites_org_email;

CREATE UNIQUE INDEX IF NOT EXISTS idx_pulse_link_invites_org_timepoint_email
  ON pulse_link_invites (organization_id, timepoint_phase, email);

CREATE INDEX IF NOT EXISTS idx_pulse_link_invites_org_timepoint
  ON pulse_link_invites (organization_id, timepoint_phase);
