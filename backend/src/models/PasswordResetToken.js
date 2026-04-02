import crypto from 'crypto';
import { query } from '../config/database.js';

const TOKEN_EXPIRY_MS = 60 * 60 * 1000; // 1 hour (forgot-password flow)

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * @param {string} userId
 * @param {{ expiresInMs?: number }} [options] — default 1h; platform welcome emails use a longer TTL
 */
export async function createResetToken(userId, options = {}) {
  const expiresInMs =
    typeof options.expiresInMs === 'number' && options.expiresInMs > 0
      ? options.expiresInMs
      : TOKEN_EXPIRY_MS;

  await query(
    `UPDATE password_reset_tokens SET used_at = NOW()
     WHERE user_id = $1 AND used_at IS NULL`,
    [userId]
  );

  const token = generateToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + expiresInMs);

  await query(
    `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [userId, tokenHash, expiresAt]
  );

  return token;
}

export async function findValidToken(token) {
  const tokenHash = hashToken(token);
  const { rows } = await query(
    `SELECT prt.id, prt.user_id, prt.expires_at
     FROM password_reset_tokens prt
     WHERE prt.token_hash = $1
       AND prt.used_at IS NULL
       AND prt.expires_at > NOW()`,
    [tokenHash]
  );
  return rows[0] || null;
}

export async function markTokenUsed(id) {
  await query(
    `UPDATE password_reset_tokens SET used_at = NOW() WHERE id = $1`,
    [id]
  );
}
