ALTER TABLE organizations
  ALTER COLUMN client_status SET DEFAULT 'prospect-new';

UPDATE organizations
SET client_status = CASE client_status
  WHEN 'lead' THEN 'prospect-new'
  WHEN 'active' THEN 'client-current'
  WHEN 'inactive' THEN 'client-previous'
  WHEN 'closed' THEN 'do-not-call-contact-blocked'
  ELSE client_status
END
WHERE kind = 'client';

ALTER TABLE organizations DROP CONSTRAINT IF EXISTS organizations_client_status_check;
ALTER TABLE organizations
  ADD CONSTRAINT organizations_client_status_check
  CHECK (
    client_status IN (
      'client-current',
      'client-previous',
      'prospect-warm',
      'prospect-cold',
      'prospect-lost',
      'prospect-new',
      'prospect-active-campaign',
      'do-not-call-contact-blocked'
    )
  );
