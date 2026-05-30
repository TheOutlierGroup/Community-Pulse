-- Phase 1b: Accounts & Contacts (Unified CRM Layer)
--
-- `accounts` represents a client company. A single account record is shared
-- across all Business Units that deal with that client, preventing duplicate
-- client profiles when one company works with multiple BUs.
--
-- `contacts` are individual people at an account. One account has many contacts.
-- Neither table replaces the existing `organizations` / `users` tables; they are
-- a CRM overlay used specifically for the Lead → Project sales/delivery lifecycle.

CREATE TABLE IF NOT EXISTS accounts (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            TEXT        NOT NULL,
  website         TEXT,
  industry        TEXT,
  address         TEXT,
  notes           TEXT,
  custom_fields   JSONB       NOT NULL DEFAULT '{}',
  created_by      UUID        REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_accounts_org
  ON accounts (organization_id);
CREATE INDEX IF NOT EXISTS idx_accounts_name
  ON accounts (organization_id, name);

CREATE TABLE IF NOT EXISTS contacts (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      UUID        NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  first_name      TEXT        NOT NULL,
  last_name       TEXT        NOT NULL,
  email           TEXT,
  phone           TEXT,
  job_title       TEXT,
  is_primary      BOOLEAN     NOT NULL DEFAULT FALSE,
  notes           TEXT,
  custom_fields   JSONB       NOT NULL DEFAULT '{}',
  created_by      UUID        REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contacts_account
  ON contacts (account_id);
CREATE INDEX IF NOT EXISTS idx_contacts_email
  ON contacts (email);
