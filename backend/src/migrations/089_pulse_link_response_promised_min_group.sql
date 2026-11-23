-- Minimum group size each respondent was told on the survey ("results are
-- only reported for groups of N or more"). Reporting uses the strictest
-- promise in each group, so lowering the minimum for a small organisation
-- can never break a promise already made. NULL (every response before this
-- column existed) is treated as the standard minimum of 5.
ALTER TABLE pulse_link_responses
  ADD COLUMN IF NOT EXISTS promised_min_group_size SMALLINT;
