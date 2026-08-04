import { query } from '../config/database.js';

export async function createToken({
  tokenHash,
  userId,
  organizationId,
  audience = 'pulse',
  expiresAt,
  mfaVerifiedAt = null,
}) {
  const { rows } = await query(
    `INSERT INTO pulse_handoff_tokens (token_hash, user_id, organization_id, audience, expires_at, mfa_verified_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [tokenHash, userId, organizationId, audience, expiresAt, mfaVerifiedAt]
  );
  return rows[0] || null;
}

export async function consumeValidToken(tokenHash, audience = 'pulse') {
  const { rows } = await query(
    `UPDATE pulse_handoff_tokens
     SET consumed_at = NOW()
     WHERE id = (
       SELECT id
       FROM pulse_handoff_tokens
       WHERE token_hash = $1
         AND audience = $2
         AND consumed_at IS NULL
         AND expires_at > NOW()
       FOR UPDATE
       LIMIT 1
     )
     RETURNING *`,
    [tokenHash, audience]
  );
  return rows[0] || null;
}
