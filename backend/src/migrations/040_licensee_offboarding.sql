-- DAT-03: per-licensee off-boarding lifecycle. We don't hard-delete on
-- request. Instead we record a `scheduled_offboard_at` (when admin
-- requested off-boarding) and `purge_after` (the moment the row becomes
-- eligible for destructive purge by the cron). The licence is also
-- flipped to `suspended` immediately so workspace access is cut.
--
-- Hard delete still goes through Organization.deleteOrganization (and
-- thus the existing ON DELETE CASCADE chains); this migration only adds
-- the bookkeeping needed to schedule it safely.

ALTER TABLE licence_config
  ADD COLUMN IF NOT EXISTS scheduled_offboard_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS purge_after TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS offboard_requested_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS offboard_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_licence_config_purge_after
  ON licence_config (purge_after)
  WHERE purge_after IS NOT NULL;
