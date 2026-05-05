-- COM-03: per-user notification preferences. Stored as JSONB so we
-- can add new toggles (digest opt-in, weekly summary cadence, etc)
-- without further migrations.
--
-- Current shape:
--   {
--     "expiryWarningOptOut": false,
--     "expiryThresholdsDays": [30, 14, 7, 1],   // optional override
--     "announcementOptOut": false
--   }
-- Missing keys mean "use the default".

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS notification_preferences JSONB NOT NULL DEFAULT '{}'::jsonb;
