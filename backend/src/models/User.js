import { query } from '../config/database.js';

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
            o.kind AS organization_kind, o.name AS organization_name
     FROM users u
     JOIN organizations o ON o.id = u.organization_id
     WHERE u.email = $1`,
    [email.toLowerCase().trim()]
  );
  return rows[0] || null;
}

export async function findUserById(id) {
  const { rows } = await query(
    `SELECT id, email, role, organization_id, created_at FROM users WHERE id = $1`,
    [id]
  );
  return rows[0] || null;
}

export async function findUserByIdWithOrg(id) {
  const { rows } = await query(
    `SELECT u.id, u.email, u.role, u.organization_id, u.created_at,
            o.kind AS organization_kind, o.name AS organization_name
     FROM users u
     JOIN organizations o ON o.id = u.organization_id
     WHERE u.id = $1`,
    [id]
  );
  return rows[0] || null;
}

export async function createUser({ email, passwordHash, role, organizationId }) {
  const { rows } = await query(
    `INSERT INTO users (email, password_hash, role, organization_id)
     VALUES ($1, $2, $3, $4)
     RETURNING id, email, role, organization_id, created_at`,
    [email.toLowerCase().trim(), passwordHash, role, organizationId]
  );
  return rows[0];
}

export async function listUsersForOrg(organizationId, { role } = {}) {
  let sql = `SELECT id, email, role, organization_id, created_at FROM users WHERE organization_id = $1`;
  const params = [organizationId];
  if (role) {
    sql += ` AND role = $2`;
    params.push(role);
  }
  sql += ` ORDER BY created_at ASC`;
  const { rows } = await query(sql, params);
  return rows;
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
     WHERE u.id = $1`,
    [userId]
  );
  return rows[0] || null;
}
