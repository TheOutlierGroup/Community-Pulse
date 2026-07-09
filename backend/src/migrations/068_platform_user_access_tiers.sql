-- Outlier's own platform-org staff get three access tiers instead of the
-- generic admin/employee split: admin (unchanged), platform (loses user
-- editing rights), and basic (loses user/settings visibility entirely and
-- is scoped to specific Business Units in Clients/Prospects).
--
-- This is additive to the `role` column, not a replacement: licensee and
-- client organizations keep using 'admin'/'employee' exactly as before —
-- they share this column but are a completely separate product surface
-- (licensee team management, client survey respondents) untouched by this
-- change. Application code is responsible for only ever assigning
-- 'platform'/'basic' to users in a platform-kind organization.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('admin', 'employee', 'platform', 'basic'));

-- Per-user Business Unit tags. For platform-org Admin/Platform-tier users
-- these are cosmetic badges; for Basic-tier users they scope visibility in
-- Clients/Prospects to only the tagged units. A user can hold multiple.
-- Mirrors the fixed BU vocabulary already used by crm_organisations.
CREATE TABLE user_business_units (
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  business_unit TEXT NOT NULL CHECK (business_unit IN (
    'Outlier Core',
    'Outlier Skate',
    'Rhythm Engine',
    'Adoption Accelerator',
    'AI-Human Workforce Design',
    'ET Inc'
  )),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, business_unit)
);

CREATE INDEX idx_user_business_units_user ON user_business_units (user_id);

-- Rollout: every existing platform-org user drops to the most restrictive
-- tier (basic, no BU tags) except Ananda Ramiah, who becomes the sole
-- admin. Licensee/client-org users are untouched (the join on o.kind
-- excludes them).
UPDATE users u
   SET role = CASE WHEN u.email = 'aramiah92@gmail.com' THEN 'admin' ELSE 'basic' END
  FROM organizations o
 WHERE u.organization_id = o.id
   AND o.kind = 'platform';
