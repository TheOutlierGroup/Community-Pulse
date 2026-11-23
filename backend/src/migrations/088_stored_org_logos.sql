-- Organisation logos are written to each web service's own disk, and the
-- CRM and Rhythm Engine services have separate disks, so a logo uploaded on
-- one was missing on the other. Logos are now mirrored here so any service
-- can restore them (see services/orgLogoStore.js).
CREATE TABLE IF NOT EXISTS stored_org_logos (
  filename TEXT PRIMARY KEY,
  content_type TEXT NOT NULL,
  data BYTEA NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
