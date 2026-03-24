-- Legacy installs: first admin ended up in a client org (e.g. before migration 004 or template data).
-- Promote the common placeholder org name so the bootstrap account can use platform features.

UPDATE organizations
SET kind = 'platform',
    name = 'Outlier'
WHERE kind = 'client'
  AND LOWER(TRIM(name)) = 'default organization';
