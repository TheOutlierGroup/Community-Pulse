ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'client';

ALTER TABLE organizations DROP CONSTRAINT IF EXISTS organizations_kind_check;
ALTER TABLE organizations ADD CONSTRAINT organizations_kind_check CHECK (kind IN ('platform', 'client'));

ALTER TABLE invites
  ADD COLUMN IF NOT EXISTS invited_role TEXT NOT NULL DEFAULT 'employee';

ALTER TABLE invites DROP CONSTRAINT IF EXISTS invites_invited_role_check;
ALTER TABLE invites ADD CONSTRAINT invites_invited_role_check CHECK (invited_role IN ('admin', 'employee'));
