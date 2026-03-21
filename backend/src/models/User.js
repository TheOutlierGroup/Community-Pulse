import { query } from '../config/database.js';

export async function findUserByEmail(email) {
  const { rows } = await query(
    `SELECT id, email, password_hash, role, organization_id FROM users WHERE email = $1`,
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

export async function createUser({ email, passwordHash, role, organizationId }) {
  const { rows } = await query(
    `INSERT INTO users (email, password_hash, role, organization_id)
     VALUES ($1, $2, $3, $4)
     RETURNING id, email, role, organization_id, created_at`,
    [email.toLowerCase().trim(), passwordHash, role, organizationId]
  );
  return rows[0];
}
