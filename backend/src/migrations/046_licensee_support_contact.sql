-- COM-04: licensee-provided support contact details. Surfaced on
-- downstream client surfaces so end-users can reach their actual
-- provider (the licensee) rather than the upstream platform.
--
-- Both fields are optional; when absent, the downstream UI falls
-- back to a generic "Contact your administrator" message.

ALTER TABLE licence_config
  ADD COLUMN IF NOT EXISTS support_email TEXT,
  ADD COLUMN IF NOT EXISTS support_url TEXT;
