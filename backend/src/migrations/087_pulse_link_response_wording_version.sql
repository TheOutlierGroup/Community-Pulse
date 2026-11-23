-- Event mode: record which statement wording each respondent answered, so
-- results gathered under the reworded statements ("event-v1") can be told
-- apart from the original wording ("current") when comparing stages.
ALTER TABLE pulse_link_responses
  ADD COLUMN IF NOT EXISTS wording_version TEXT NOT NULL DEFAULT 'current';
