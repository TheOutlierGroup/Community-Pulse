-- Index completed_at on both response tables to support efficient
-- rolling time-bucket queries (trend chart, delta calculations).
-- Partial index on non-null values only, since incomplete responses
-- are excluded from all aggregate calculations.

CREATE INDEX IF NOT EXISTS idx_employee_responses_completed_at
  ON employee_responses(completed_at)
  WHERE completed_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pulse_link_responses_completed_at
  ON pulse_link_responses(completed_at)
  WHERE completed_at IS NOT NULL;
