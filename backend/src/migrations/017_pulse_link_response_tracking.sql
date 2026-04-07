-- Track link open vs survey start for Pulse link recipients (admin status).

ALTER TABLE pulse_link_responses
  ADD COLUMN IF NOT EXISTS link_opened_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS survey_started_at TIMESTAMPTZ;

-- Existing rows: treat created time as first open; infer "started" from saved progress.
UPDATE pulse_link_responses
SET link_opened_at = COALESCE(link_opened_at, created_at)
WHERE link_opened_at IS NULL;

UPDATE pulse_link_responses
SET survey_started_at = COALESCE(survey_started_at, updated_at)
WHERE survey_started_at IS NULL
  AND (
    completed_at IS NOT NULL
    OR current_step > 1
    OR step1_data <> '{}'::jsonb
    OR step2_data <> '{}'::jsonb
    OR step3_data <> '{}'::jsonb
    OR step4_data <> '{}'::jsonb
  );
