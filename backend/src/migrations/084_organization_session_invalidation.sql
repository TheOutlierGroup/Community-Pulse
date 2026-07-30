-- CRD-027 (migration 082) stamps users.sessions_invalidated_at for
-- privilege changes at the user level: role, login_enabled, password,
-- both MFA mutations, deactivation. organizationKind is baked into the
-- sign-in token exactly the same way role is (see every signToken call
-- site in routes/auth.js) and requireAuth trusts it for the token's whole
-- 7-day life the same way — but nothing mirrors the revocation stamp at
-- the organization level, so a kind change leaves every member of that
-- org running on a token that still carries the old kind until it
-- expires on its own.
--
-- No route changes an existing organization's kind today — createOrganization
-- sets it once, and orgRoutes.js's settings-patch handler explicitly
-- refuses to touch it after creation. That is exactly the shape migration
-- 068's mass role reassignment was before CRD-027: not a normal app code
-- path, but still capable of leaving stale, over-privileged tokens
-- outstanding if done directly. This control needs to hold regardless of
-- whether the next kind change arrives through a future endpoint or an
-- operator running SQL by hand — see Organization.updateOrganizationKind.
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS member_sessions_invalidated_at TIMESTAMPTZ;
