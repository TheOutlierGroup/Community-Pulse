import { query } from '../config/database.js';

export async function createInvite({ email, token, organizationId, expiresAt }) {
  const { rows } = await query(
    `INSERT INTO invites (email, token, organization_id, expires_at)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [email.toLowerCase().trim(), token, organizationId, expiresAt]
  );
  return rows[0];
}

export async function findValidInvite(token) {
  const { rows } = await query(
    `SELECT * FROM invites WHERE token = $1 AND used_at IS NULL AND expires_at > NOW()`,
    [token]
  );
  return rows[0] || null;
}

export async function markInviteUsed(id) {
  await query(`UPDATE invites SET used_at = NOW() WHERE id = $1`, [id]);
}
