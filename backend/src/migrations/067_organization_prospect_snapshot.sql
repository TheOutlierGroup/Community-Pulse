-- A static, point-in-time snapshot of everything known about a prospect at
-- the moment it was promoted to a Client: core fields, notes, contacts, and
-- its full CRM activity log. Captured once at promotion and never touched
-- again, so it stays available (downloadable as CSV) independent of the
-- live Recent Activity tracker that continues to grow on the Client side.

ALTER TABLE organizations ADD COLUMN prospect_snapshot JSONB;
