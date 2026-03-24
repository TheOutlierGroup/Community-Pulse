-- Organizations created before `kind` existed (migration 002) were backfilled as `client`.
-- Outlier / platform org must be `platform` to access /api/platform/* and see Clients / Users in the app.
-- If your platform org uses a different name, run: UPDATE organizations SET kind = 'platform' WHERE id = '…';

UPDATE organizations
SET kind = 'platform'
WHERE kind = 'client'
  AND LOWER(TRIM(name)) = 'outlier';
