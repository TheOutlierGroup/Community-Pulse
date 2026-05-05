-- COM-01: per-licensee overrides for outbound email templates. Stored
-- as JSONB so we can add new templates without further migrations.
-- Schema convention:
--   {
--     "expiryWarning": { "subject": "...", "intro": "..." },
--     "welcome":       { "subject": "...", "intro": "..." }
--   }
-- Unset fields fall back to the platform defaults in services/email.js.

ALTER TABLE licence_config
  ADD COLUMN IF NOT EXISTS email_template_overrides JSONB NOT NULL DEFAULT '{}'::jsonb;
