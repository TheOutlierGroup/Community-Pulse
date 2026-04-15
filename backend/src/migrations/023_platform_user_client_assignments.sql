CREATE TABLE IF NOT EXISTS platform_user_client_assignments (
  platform_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (platform_user_id, client_org_id)
);

CREATE INDEX IF NOT EXISTS idx_platform_user_client_assignments_client
  ON platform_user_client_assignments (client_org_id);

INSERT INTO platform_user_client_assignments (platform_user_id, client_org_id)
SELECT u.id, c.id
FROM users u
JOIN organizations p ON p.id = u.organization_id
JOIN organizations c ON c.kind = 'client'
LEFT JOIN platform_user_client_assignments a
  ON a.platform_user_id = u.id AND a.client_org_id = c.id
WHERE p.kind = 'platform'
  AND u.deactivated_at IS NULL
  AND a.platform_user_id IS NULL;
