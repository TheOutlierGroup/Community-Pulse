import { query } from '../config/database.js';

const NAME_MAX = 120;

function sanitizeName(v) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  return s.slice(0, NAME_MAX);
}

export async function findUserByEmail(email) {
  const { rows } = await query(
    `SELECT id, email, password_hash, role, organization_id FROM users WHERE email = $1`,
    [email.toLowerCase().trim()]
  );
  return rows[0] || null;
}

export async function findUserByEmailWithOrg(email) {
  const { rows } = await query(
    `SELECT u.id, u.email, u.password_hash, u.role, u.organization_id,
            u.first_name, u.last_name, u.profile_avatar_filename, u.login_enabled,
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

/** Client org members + all platform-org users (for task assign / @mentions). */
export async function listAssignableUsersForClientTasks(clientOrgId) {
  const { rows } = await query(
    `SELECT DISTINCT u.id, u.email, u.role, u.organization_id, u.first_name, u.last_name,
            u.profile_avatar_filename, o.kind AS organization_kind
     FROM users u
     JOIN organizations o ON o.id = u.organization_id
     LEFT JOIN platform_user_client_assignments a
       ON a.platform_user_id = u.id
      AND a.client_org_id = $1
     WHERE u.deactivated_at IS NULL
       AND (
         u.organization_id = $1
         OR (
           o.kind = 'platform'
           AND (u.role = 'admin' OR a.platform_user_id IS NOT NULL)
         )
       )
     ORDER BY (CASE WHEN o.kind = 'platform' THEN 0 ELSE 1 END), u.email ASC`,
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

export async function listUsersForOrg(organizationId, { role, limit, offset } = {}) {
  const cappedLimit =
    Number.isInteger(limit) && limit > 0 ? Math.min(limit, 500) : 200;
  const safeOffset = Number.isInteger(offset) && offset >= 0 ? offset : 0;
  let sql = `SELECT id, email, role, organization_id, created_at, first_name, last_name, profile_avatar_filename, login_enabled
             FROM users WHERE organization_id = $1 AND deactivated_at IS NULL`;
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

export async function isUserActive(userId) {
  const { rows } = await query(
    `SELECT 1 FROM users WHERE id = $1 AND deactivated_at IS NULL AND login_enabled = true`,
    [userId]
  );
  return rows.length > 0;
}

export async function deactivateUserInOrg(userId, organizationId) {
  const { rowCount } = await query(
    `UPDATE users SET deactivated_at = NOW()
     WHERE id = $1 AND organization_id = $2 AND deactivated_at IS NULL`,
    [userId, organizationId]
  );
  return rowCount > 0;
}

export async function getPasswordHashByUserId(userId) {
  const { rows } = await query(`SELECT password_hash FROM users WHERE id = $1`, [userId]);
  return rows[0]?.password_hash || null;
}

export async function updateUserPassword(userId, passwordHash) {
  const { rows } = await query(
    `UPDATE users SET password_hash = $2 WHERE id = $1 RETURNING id`,
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

export async function updateStaffUserInOrg(userId, organizationId, body) {
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
  if ('role' in body) {
    const r = body.role === 'employee' ? 'employee' : 'admin';
    parts.push(`role = $${n++}`);
    vals.push(r);
  }
  if ('loginEnabled' in body) {
    parts.push(`login_enabled = $${n++}`);
    vals.push(Boolean(body.loginEnabled));
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
