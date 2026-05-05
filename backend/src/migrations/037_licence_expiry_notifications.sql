-- INF-11: ledger of expiry warning emails dispatched per licensee per
-- threshold (e.g. 30/14/7/1 days before contract_end). The unique
-- (organization_id, contract_end, threshold_days) constraint prevents
-- double-emailing for the same contract window when the sweep runs more
-- than once per day. If a licensee renews (contract_end moves), the new
-- contract_end naturally gets its own row.

CREATE TABLE IF NOT EXISTS licence_expiry_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contract_end TIMESTAMPTZ NOT NULL,
  threshold_days INTEGER NOT NULL,
  recipients_count INTEGER NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT licence_expiry_notifications_threshold_nonneg
    CHECK (threshold_days >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_licence_expiry_notifications
  ON licence_expiry_notifications (organization_id, contract_end, threshold_days);

CREATE INDEX IF NOT EXISTS idx_licence_expiry_notifications_org
  ON licence_expiry_notifications (organization_id, sent_at DESC);
