ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS company_logo_filename TEXT;
