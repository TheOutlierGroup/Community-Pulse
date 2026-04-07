import { query } from '../config/database.js';
import { hashInviteToken } from '../security/inviteToken.js';

const NAME_MAX = 120;

function sanitizeName(v) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  return s.slice(0, NAME_MAX);
}

export async function createInvite({
  email,
  token,
  organizationId,
  expiresAt,
  invitedRole = 'employee',
  firstName,
  lastName,
}) {
  const tokenHash = hashInviteToken(token);
  const { rows } = await query(
    `INSERT INTO invites (email, token, organization_id, expires_at, invited_role, first_name, last_name)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [
      email.toLowerCase().trim(),
      tokenHash,
      organizationId,
      expiresAt,
      invitedRole,
      sanitizeName(firstName),
      sanitizeName(lastName),
    ]
  );
  return {
    ...rows[0],
    token,
  };
}

export async function findValidInvite(token) {
  const tokenHash = hashInviteToken(token);
  const { rows } = await query(
    `SELECT * FROM invites
     WHERE (token = $1 OR token = $2)
       AND used_at IS NULL
       AND expires_at > NOW()`,
    [tokenHash, token]
  );
  return rows[0] || null;
}

export async function markInviteUsed(id) {
  await query(`UPDATE invites SET used_at = NOW() WHERE id = $1`, [id]);
}
