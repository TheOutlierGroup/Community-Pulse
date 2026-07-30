-- 068_platform_user_access_tiers.sql granted the sole platform Admin seat
-- to 'aramiah92@gmail.com' — the Claude Code session's own account email
-- at the time, not a real Outlier login. 069_fix_admin_rollout_email.sql
-- corrected the role assignment (ananda@theoutliergroup.com.au -> admin,
-- aramiah92@gmail.com -> basic) but left the mistaken row itself in
-- place, still holding the platform's lowest access tier.
--
-- Deactivate rather than delete: this mirrors User.deactivateUserInOrg,
-- the codebase's existing, reversible way to fully revoke a user's
-- access (blocks login via getAuthStateForUser, and PT-05's
-- sessions_invalidated_at revokes any token already issued to it) without
-- risking an ON DELETE RESTRICT failure against tables that reference
-- users(id) (e.g. generated_reports.generated_by) or destroying the audit
-- trail of how this seat was created and corrected. If this address is
-- later confirmed to need no record at all, that's a follow-up deletion
-- once the account's referential footprint has been checked by hand —
-- not something to guess at in an automated migration.
--
-- Scoped, like 068/069, to platform-kind organizations, and guarded so
-- this is a no-op if the row was already deactivated or never existed in
-- whatever environment this runs against.
UPDATE users u
   SET deactivated_at = NOW(),
       login_enabled = false,
       sessions_invalidated_at = NOW()
  FROM organizations o
 WHERE u.organization_id = o.id
   AND o.kind = 'platform'
   AND u.email = 'aramiah92@gmail.com'
   AND u.deactivated_at IS NULL;
