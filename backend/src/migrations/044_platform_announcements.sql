-- COM-02: platform announcements. Distinct from status incidents:
--   - status incidents are about platform health (outages, maintenance)
--     and use red/yellow banners
--   - announcements are product news (new feature, policy update,
--     end-of-year notes) and use a calm blue banner
--
-- COM-05: each row also carries `email_sent_at` so the bulk-email
-- broadcast can be triggered separately from creation, and so we never
-- double-send.

CREATE TABLE IF NOT EXISTS platform_announcements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  audience TEXT NOT NULL DEFAULT 'all',
  banner BOOLEAN NOT NULL DEFAULT TRUE,
  email_on_publish BOOLEAN NOT NULL DEFAULT FALSE,
  email_sent_at TIMESTAMPTZ,
  email_recipients_count INTEGER,
  published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT platform_announcements_title_nonempty CHECK (length(trim(title)) > 0),
  CONSTRAINT platform_announcements_body_nonempty CHECK (length(trim(body)) > 0),
  CONSTRAINT platform_announcements_audience_check CHECK (audience IN ('all', 'platform', 'licensee'))
);

CREATE INDEX IF NOT EXISTS idx_platform_announcements_active
  ON platform_announcements (published_at DESC)
  WHERE banner = TRUE;
