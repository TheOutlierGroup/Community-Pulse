-- Phase 5: Outbound webhook engine
--
-- `webhook_endpoints` stores the URL + event subscriptions per org.
-- A signing_secret is generated on creation and used to compute an
-- HMAC-SHA256 signature header (X-Pulse-Signature) on every dispatch
-- so the receiver can verify authenticity.
--
-- `webhook_dispatch_log` is an append-only audit of every outbound
-- attempt — status, HTTP response code, and any error detail.
-- It is intentionally not cleaned by the regular retention sweep so
-- event history is preserved for debugging.

CREATE TABLE IF NOT EXISTS webhook_endpoints (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  url             TEXT        NOT NULL,
  description     TEXT,
  -- Array of subscribed event names, e.g. ["lead.created","project.over_budget"]
  events          JSONB       NOT NULL DEFAULT '[]',
  signing_secret  TEXT        NOT NULL,
  is_active       BOOLEAN     NOT NULL DEFAULT TRUE,
  created_by      UUID        REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhook_endpoints_org
  ON webhook_endpoints (organization_id)
  WHERE is_active = TRUE;

CREATE TABLE IF NOT EXISTS webhook_dispatch_log (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_endpoint_id UUID        NOT NULL REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
  event_name          TEXT        NOT NULL,
  payload             JSONB       NOT NULL DEFAULT '{}',
  attempt             INTEGER     NOT NULL DEFAULT 1,
  status              TEXT        NOT NULL DEFAULT 'pending'
                                  CHECK (status IN ('pending', 'delivered', 'failed')),
  response_status     INTEGER,
  error_detail        TEXT,
  dispatched_at       TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhook_dispatch_log_endpoint
  ON webhook_dispatch_log (webhook_endpoint_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_webhook_dispatch_log_status
  ON webhook_dispatch_log (status) WHERE status = 'failed';
