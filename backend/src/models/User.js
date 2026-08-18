import { query } from '../config/database.js';

const NAME_MAX = 120;

// Access tiers for users belonging to a platform-kind organization (Outlier's
// own internal staff). Licensee/client-org users never use these — they keep
// the plain 'admin'/'employee' roles this column has always had.
export const PLATFORM_ORG_ROLES = ['admin', 'platform', 'basic'];

function sanitizeName(v) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  return s.slice(0, NAME_MAX);
}

export async function findUserByEmail(email) {
  const { rows } = await query(
    `SELECT id, email, password_hash, role, organization_id, deactivated_at FROM users WHERE email = $1`,
    [email.toLowerCase().trim()]
  );
  return rows[0] || null;
}

export async function findUserByEmailWithOrg(email) {
  const { rows } = await query(
    `SELECT u.id, u.email, u.password_hash, u.role, u.organization_id,
            u.first_name, u.last_name, u.profile_avatar_filename, u.login_enabled,
            u.mfa_enabled, u.mfa_secret, u.mfa_recovery_codes, u.last_mfa_verified_at,
            o.kind AS organization_kind, o.name AS organization_name,
            o.company_logo_filename AS organization_company_logo_filename,
            o.settings AS organization_settings
     FROM users u
     JOIN organizations o ON o.id = u.organization_id
     WHERE u.email = $1 AND u.deactivated_at IS NULL`,
    [email.toLowerCase().trim()]
  );
  return rows[0] || null;
}

export async function findUserById(id) {
  const { rows } = await query(
    `SELECT id, email, role, organization_id, first_name, last_name, profile_avatar_filename, created_at,
            deactivated_at, login_enabled
     FROM users WHERE id = $1`,
    [id]
  );
  return rows[0] || null;
}

export async function findUserByIdWithOrg(id) {
  const { rows } = await query(
    `SELECT u.id, u.email, u.role, u.organization_id, u.created_at,
            u.first_name, u.last_name, u.profile_avatar_filename, u.deactivated_at, u.login_enabled,
            u.mfa_enabled, u.mfa_secret, u.mfa_recovery_codes, u.last_mfa_verified_at,
            o.kind AS organization_kind, o.name AS organization_name,
            o.company_logo_filename AS organization_company_logo_filename,
            o.settings AS organization_settings
     FROM users u
     JOIN organizations o ON o.id = u.organization_id
     WHERE u.id = $1`,
    [id]
  );
  return rows[0] || null;
}

export async function createUser({ email, passwordHash, role, organizationId, loginEnabled = true }) {
  const { rows } = await query(
    `INSERT INTO users (email, password_hash, role, organization_id, login_enabled)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, email, role, organization_id, created_at, login_enabled`,
    [email.toLowerCase().trim(), passwordHash, role, organizationId, Boolean(loginEnabled)]
  );
  return rows[0];
}

export async function createUserWithProfile({
  email,
  passwordHash,
  role,
  organizationId,
  firstName,
  lastName,
  loginEnabled = true,
}) {
  const { rows } = await query(
    `INSERT INTO users (email, password_hash, role, organization_id, first_name, last_name, login_enabled)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, email, role, organization_id, first_name, last_name, profile_avatar_filename, created_at, login_enabled`,
    [
      email.toLowerCase().trim(),
      passwordHash,
      role,
      organizationId,
      sanitizeName(firstName),
      sanitizeName(lastName),
      Boolean(loginEnabled),
    ]
  );
  return rows[0];
}

/**
 * Client org members + all platform-org users (for task assign / @mentions).
 * Pass `{ clientOnly: true }` to drop the platform-staff branch entirely —
 * used for Enterprise client self-service callers, who should never see
 * Outlier staff in the assignable list, only their own org's members.
 */
export async function listAssignableUsersForClientTasks(clientOrgId, { clientOnly = false } = {}) {
  const { rows } = await query(
    `SELECT DISTINCT u.id, u.email, u.role, u.organization_id, u.first_name, u.last_name,
            u.profile_avatar_filename, o.kind AS organization_kind,
            (CASE WHEN o.kind = 'platform' THEN 0 ELSE 1 END) AS sort_platform_first
     FROM users u
     JOIN organizations o ON o.id = u.organization_id
     LEFT JOIN platform_user_client_assignments a
       ON a.platform_user_id = u.id
      AND a.client_org_id = $1
     WHERE u.deactivated_at IS NULL
       AND (
         u.organization_id = $1
         ${clientOnly ? '' : `OR (
           o.kind = 'platform'
           AND (u.role = 'admin' OR a.platform_user_id IS NOT NULL)
         )`}
       )
     ORDER BY sort_platform_first, u.email ASC`,
    [clientOrgId]
  );
  return rows;
}

export async function countActiveUsersForClientOrg(organizationId) {
  const { rows } = await query(
    `SELECT COUNT(*)::int AS c FROM users WHERE organization_id = $1 AND deactivated_at IS NULL`,
    [organizationId]
  );
  return rows[0]?.c ?? 0;
}

export async function countActiveUsersByRoleForOrg(organizationId) {
  const { rows } = await query(
    `SELECT role, COUNT(*)::int AS c
     FROM users
     WHERE organization_id = $1 AND deactivated_at IS NULL
     GROUP BY role`,
    [organizationId]
  );
  const counts = { employee: 0, admin: 0 };
  for (const row of rows) {
    if (row.role === 'employee') counts.employee = row.c;
    else if (row.role === 'admin') counts.admin = row.c;
  }
  return counts;
}

export async function listUsersForOrg(organizationId, { role, limit, offset, includeDeactivated = false } = {}) {
  const cappedLimit =
    Number.isInteger(limit) && limit > 0 ? Math.min(limit, 500) : 200;
  const safeOffset = Number.isInteger(offset) && offset >= 0 ? offset : 0;
  // Deactivated rows are included when asked for (the user-management list
  // shows them greyed out so an admin can reinstate one), but a purged row
  // is scrubbed and gone for good regardless — every other caller (email
  // notifications, admin lists, exports) keeps the original active-only
  // behaviour by not passing this.
  let sql = `SELECT id, email, role, organization_id, created_at, first_name, last_name, profile_avatar_filename, login_enabled, deactivated_at
             FROM users WHERE organization_id = $1 AND purged_at IS NULL`;
  if (!includeDeactivated) sql += ` AND deactivated_at IS NULL`;
  const params = [organizationId];
  let idx = 2;
  if (role) {
    sql += ` AND role = $${idx++}`;
    params.push(role);
  }
  sql += ` ORDER BY created_at ASC LIMIT $${idx++} OFFSET $${idx++}`;
  params.push(cappedLimit, safeOffset);
  const { rows } = await query(sql, params);
  return rows;
}

// ── Platform-org Business Unit tags ─────────────────────────────────────────
// Only meaningful for platform-kind org users (see PLATFORM_ORG_ROLES above).

export async function getBusinessUnitsForUser(userId) {
  const { rows } = await query(
    `SELECT business_unit FROM user_business_units WHERE user_id = $1 ORDER BY business_unit ASC`,
    [userId]
  );
  return rows.map((row) => row.business_unit);
}

/** Batch form for list views — returns a Map<userId, string[]>. */
export async function getBusinessUnitsForUsers(userIds) {
  const ids = (userIds || []).map((id) => String(id)).filter(Boolean);
  const map = new Map();
  if (!ids.length) return map;
  const { rows } = await query(
    `SELECT user_id, business_unit FROM user_business_units WHERE user_id = ANY($1::uuid[]) ORDER BY business_unit ASC`,
    [ids]
  );
  for (const row of rows) {
    const key = String(row.user_id);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row.business_unit);
  }
  return map;
}

/** Replaces the full set of BU tags for a user. Pass [] to clear all tags. */
export async function setBusinessUnitsForUser(userId, businessUnits) {
  const unique = [...new Set((businessUnits || []).map((bu) => String(bu || '').trim()).filter(Boolean))];
  await query(`DELETE FROM user_business_units WHERE user_id = $1`, [userId]);
  for (const bu of unique) {
    await query(
      `INSERT INTO user_business_units (user_id, business_unit) VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [userId, bu]
    );
  }
  return unique;
}

export async function isUserActive(userId) {
  const { rows } = await query(
    `SELECT 1 FROM users WHERE id = $1 AND deactivated_at IS NULL AND login_enabled = true`,
    [userId]
  );
  return rows.length > 0;
}

/**
 * PT-05: everything requireAuth needs to re-validate per request, in the
 * one round trip it was already making for isUserActive.
 *
 * Also folds in the user's organization's member_sessions_invalidated_at
 * via GREATEST, so a token is rejected if either the user's own
 * privileges changed (role, login, password, MFA, deactivation) or their
 * organization's kind did — organizationKind is baked into the token
 * exactly like role is, so it needs the same revocation coverage.
 * GREATEST ignores NULL operands in Postgres (only NULL if both are), so
 * this is a no-op fold-in when neither has ever been stamped. LEFT JOIN
 * because organization_id is nullable.
 *
 * Returns null when the account can no longer authenticate at all, so the
 * caller keeps a single "reject" branch for deactivation and revocation.
 */
export async function getAuthStateForUser(userId) {
  const { rows } = await query(
    `SELECT GREATEST(u.sessions_invalidated_at, o.member_sessions_invalidated_at) AS sessions_invalidated_at
     FROM users u
     LEFT JOIN organizations o ON o.id = u.organization_id
     WHERE u.id = $1 AND u.deactivated_at IS NULL AND u.login_enabled = true`,
    [userId]
  );
  if (!rows.length) return null;
  return { sessionsInvalidatedAt: rows[0].sessions_invalidated_at || null };
}

/**
 * Revokes every session issued to this user before now. Called from the
 * mutations that change what a token is allowed to do — role change,
 * password change, MFA enable/disable, deactivation — so the next request
 * on an old token is rejected instead of running on stale claims.
 */
export async function invalidateSessionsForUser(userId) {
  const { rows } = await query(
    `UPDATE users SET sessions_invalidated_at = NOW() WHERE id = $1 RETURNING id`,
    [userId]
  );
  return rows[0] || null;
}

export async function deactivateUserInOrg(userId, organizationId) {
  const { rowCount } = await query(
    `UPDATE users SET deactivated_at = NOW(), sessions_invalidated_at = NOW()
     WHERE id = $1 AND organization_id = $2 AND deactivated_at IS NULL`,
    [userId, organizationId]
  );
  return rowCount > 0;
}

/** Clears deactivation so the row can sign in again (same org only). */
export async function reactivateUserInOrg(userId, organizationId) {
  const { rowCount } = await query(
    `UPDATE users SET deactivated_at = NULL
     WHERE id = $1 AND organization_id = $2 AND deactivated_at IS NOT NULL`,
    [userId, organizationId]
  );
  return rowCount > 0;
}

/**
 * Permanently removes a user from view without a real row DELETE — see
 * migration 086 for why (generated_reports.generated_by is ON DELETE
 * RESTRICT, so a genuine delete would fail for any user who ever generated
 * a report). Scrubs PII and frees the email (still UNIQUE) so the same
 * address can be re-invited later as a fresh account. Only ever called on
 * an already-deactivated row — the UI only offers this on greyed-out users
 * — enforced here too since it's the one irreversible step.
 */
export async function purgeUserInOrg(userId, organizationId) {
  const { rows } = await query(
    `UPDATE users
     SET email = 'deleted-user-' || id || '@deleted.invalid',
         first_name = NULL,
         last_name = NULL,
         profile_avatar_filename = NULL,
         login_enabled = false,
         purged_at = NOW()
     WHERE id = $1 AND organization_id = $2 AND deactivated_at IS NOT NULL AND purged_at IS NULL
     RETURNING id`,
    [userId, organizationId]
  );
  return rows.length > 0;
}

export async function getPasswordHashByUserId(userId) {
  const { rows } = await query(`SELECT password_hash FROM users WHERE id = $1`, [userId]);
  return rows[0]?.password_hash || null;
}

export async function updateUserPassword(userId, passwordHash) {
  // PT-05: revoking here is the whole point of a password reset — an
  // attacker holding a stolen token must not keep it after the account
  // owner changes the credential.
  const { rows } = await query(
    `UPDATE users
     SET password_hash = $2, sessions_invalidated_at = NOW()
     WHERE id = $1 RETURNING id`,
    [userId, passwordHash]
  );
  return rows[0] || null;
}

export async function getUserOrgKind(userId) {
  const { rows } = await query(
    `SELECT u.organization_id, o.kind
     FROM users u
     JOIN organizations o ON o.id = u.organization_id
     WHERE u.id = $1 AND u.deactivated_at IS NULL`,
    [userId]
  );
  return rows[0] || null;
}

/**
 * @param roleOptions.allowedRoles - valid role values for the target user's
 *   org kind. Defaults to the historical admin/employee pair (licensee +
 *   client-org staff); pass PLATFORM_ORG_ROLES for a platform-kind org user.
 * @param roleOptions.invalidRoleFallback - role applied when body.role isn't
 *   in allowedRoles. Defaults to 'admin' to match this function's original
 *   behavior for the legacy pair; callers using PLATFORM_ORG_ROLES should
 *   pass 'basic' so a malformed request can't silently escalate privilege.
 */
export async function updateStaffUserInOrg(
  userId,
  organizationId,
  body,
  { allowedRoles = ['admin', 'employee'], invalidRoleFallback = 'admin' } = {}
) {
  const target = await findUserById(userId);
  if (!target || target.organization_id !== organizationId || target.deactivated_at) return null;
  const parts = [];
  const vals = [];
  let n = 1;
  if ('firstName' in body) {
    parts.push(`first_name = $${n++}`);
    vals.push(sanitizeName(body.firstName));
  }
  if ('lastName' in body) {
    parts.push(`last_name = $${n++}`);
    vals.push(sanitizeName(body.lastName));
  }
  if ('email' in body) {
    parts.push(`email = $${n++}`);
    vals.push(String(body.email).toLowerCase().trim());
  }
  // PT-05: role and login_enabled both change what an already-issued
  // token is allowed to do, and both are read from the JWT rather than
  // re-fetched per request. Revoke in the same statement so a demotion
  // takes effect on the next request instead of at token expiry (7 days
  // by default) — the case migration 068's mass tier reassignment hit.
  let revokeSessions = false;
  if ('role' in body) {
    const r = allowedRoles.includes(body.role) ? body.role : invalidRoleFallback;
    parts.push(`role = $${n++}`);
    vals.push(r);
    revokeSessions = true;
  }
  if ('loginEnabled' in body) {
    parts.push(`login_enabled = $${n++}`);
    vals.push(Boolean(body.loginEnabled));
    revokeSessions = true;
  }
  if (revokeSessions) {
    parts.push('sessions_invalidated_at = NOW()');
  }
  if (!parts.length) return findUserById(userId);
  vals.push(userId, organizationId);
  const { rows } = await query(
    `UPDATE users SET ${parts.join(', ')}
     WHERE id = $${n++} AND organization_id = $${n++} AND deactivated_at IS NULL
     RETURNING id`,
    vals
  );
  if (!rows.length) return null;
  return findUserById(userId);
}

export async function updateProfileNames(userId, patch) {
  const parts = [];
  const vals = [];
  let n = 1;
  if ('firstName' in patch) {
    parts.push(`first_name = $${n++}`);
    vals.push(sanitizeName(patch.firstName));
  }
  if ('lastName' in patch) {
    parts.push(`last_name = $${n++}`);
    vals.push(sanitizeName(patch.lastName));
  }
  if (!parts.length) return null;
  vals.push(userId);
  await query(`UPDATE users SET ${parts.join(', ')} WHERE id = $${n}`, vals);
  return findUserByIdWithOrg(userId);
}

export async function getProfileAvatarFilename(userId) {
  const { rows } = await query(
    `SELECT profile_avatar_filename FROM users WHERE id = $1`,
    [userId]
  );
  return rows[0]?.profile_avatar_filename || null;
}

export async function setProfileAvatarFilename(userId, filename) {
  await query(`UPDATE users SET profile_avatar_filename = $2 WHERE id = $1`, [userId, filename]);
}

export async function clearProfileAvatarFilename(userId) {
  const prev = await getProfileAvatarFilename(userId);
  await query(`UPDATE users SET profile_avatar_filename = NULL WHERE id = $1`, [userId]);
  return prev;
}

export async function listPlatformAdminUsers() {
  const { rows } = await query(
    `SELECT u.id
     FROM users u
     JOIN organizations o ON o.id = u.organization_id
     WHERE o.kind = 'platform' AND u.role = 'admin' AND u.deactivated_at IS NULL`
  );
  return rows;
}

export async function storeMfaSecret(userId, mfaSecret, recoveryCodeHashes = []) {
  const jsonRecoveryCodes = JSON.stringify(
    Array.isArray(recoveryCodeHashes) ? recoveryCodeHashes : []
  );
  const { rows } = await query(
    `UPDATE users
     SET mfa_secret = $2,
         mfa_recovery_codes = $3::jsonb,
         mfa_enabled = false,
         last_mfa_verified_at = NULL
     WHERE id = $1
     RETURNING id, mfa_secret, mfa_recovery_codes, mfa_enabled`,
    [userId, mfaSecret, jsonRecoveryCodes]
  );
  return rows[0] || null;
}

export async function enableMfaForUser(userId) {
  const { rows } = await query(
    `UPDATE users
     SET mfa_enabled = true,
         last_mfa_verified_at = NOW(),
         sessions_invalidated_at = NOW()
     WHERE id = $1
     RETURNING id, mfa_enabled, last_mfa_verified_at`,
    [userId]
  );
  return rows[0] || null;
}

export async function disableMfaForUser(userId) {
  const { rows } = await query(
    `UPDATE users
     SET mfa_enabled = false,
         mfa_secret = NULL,
         mfa_recovery_codes = '[]'::jsonb,
         last_mfa_verified_at = NULL,
         sessions_invalidated_at = NOW()
     WHERE id = $1
     RETURNING id, mfa_enabled`,
    [userId]
  );
  return rows[0] || null;
}

export async function replaceMfaRecoveryCodeHashes(userId, recoveryCodeHashes = []) {
  const jsonRecoveryCodes = JSON.stringify(
    Array.isArray(recoveryCodeHashes) ? recoveryCodeHashes : []
  );
  const { rows } = await query(
    `UPDATE users
     SET mfa_recovery_codes = $2::jsonb
     WHERE id = $1
     RETURNING id, mfa_recovery_codes`,
    [userId, jsonRecoveryCodes]
  );
  return rows[0] || null;
}

export async function updateLastMfaVerifiedAt(userId) {
  await query(`UPDATE users SET last_mfa_verified_at = NOW() WHERE id = $1`, [userId]);
}

/**
 * COM-03 read helper. Returns the JSONB notification_preferences blob
 * for a user, defaulting to {} so callers don't have to null-check.
 */
export async function getNotificationPreferences(userId) {
  if (!userId) return {};
  const { rows } = await query(
    `SELECT notification_preferences FROM users WHERE id = $1`,
    [userId]
  );
  return rows[0]?.notification_preferences || {};
}

/**
 * COM-03 write helper. Performs a JSONB merge so callers can patch a
 * subset of preferences without resetting the others.
 */
export async function setNotificationPreferences(userId, preferences) {
  if (!userId) return null;
  const next = preferences && typeof preferences === 'object' ? preferences : {};
  const { rows } = await query(
    `UPDATE users
       SET notification_preferences = COALESCE(notification_preferences, '{}'::jsonb) || $2::jsonb
     WHERE id = $1
     RETURNING notification_preferences`,
    [userId, JSON.stringify(next)]
  );
  return rows[0]?.notification_preferences || null;
}
