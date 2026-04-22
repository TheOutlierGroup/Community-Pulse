ALTER TABLE employee_responses
  ADD COLUMN IF NOT EXISTS stage TEXT;

UPDATE employee_responses er
SET stage = CASE
  WHEN ps.session_purpose = 'during_project' THEN 'mid'
  WHEN ps.session_purpose = 'completed_project' THEN 'post'
  ELSE 'pre'
END
FROM pulse_sessions ps
WHERE er.session_id = ps.id
  AND er.stage IS NULL;

ALTER TABLE employee_responses
  ALTER COLUMN stage SET DEFAULT 'pre';

ALTER TABLE employee_responses
  ALTER COLUMN stage SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'employee_responses_stage_check'
  ) THEN
    ALTER TABLE employee_responses
      ADD CONSTRAINT employee_responses_stage_check
      CHECK (stage IN ('pre', 'mid', 'post'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_employee_responses_session_stage
  ON employee_responses (session_id, stage);

ALTER TABLE pulse_link_responses
  ADD COLUMN IF NOT EXISTS stage TEXT;

UPDATE pulse_link_responses plr
SET stage = CASE
  WHEN pli.timepoint_phase = 'during' THEN 'mid'
  WHEN pli.timepoint_phase = 'completed' THEN 'post'
  ELSE 'pre'
END
FROM pulse_link_invites pli
WHERE plr.invite_id = pli.id
  AND plr.stage IS NULL;

ALTER TABLE pulse_link_responses
  ALTER COLUMN stage SET DEFAULT 'pre';

ALTER TABLE pulse_link_responses
  ALTER COLUMN stage SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'pulse_link_responses_stage_check'
  ) THEN
    ALTER TABLE pulse_link_responses
      ADD CONSTRAINT pulse_link_responses_stage_check
      CHECK (stage IN ('pre', 'mid', 'post'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_pulse_link_responses_session_stage
  ON pulse_link_responses (session_id, stage);

