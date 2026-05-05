import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { query } from '../config/database.js';

/**
 * SEC-03 licensee API key model.
 *
 * Storage rules:
 *   - bcrypt hash of the full plaintext (never the raw secret)
 *   - 8-char prefix kept in plaintext for human recognition; the prefix
 *     is part of the key string itself so a leaked prefix does NOT
 *     bypass the hash check on its own
 *   - revoked keys are soft-deleted (revoked_at) so we keep history;
 *     active-key lookups always include `WHERE revoked_at IS NULL`
 *
 * Format: `rk_<22 url-safe random chars>` — total length 25.
 *   - "rk" = "rhythm key"; lets future log-scrapers recognise leaked
 *     keys without scanning the whole repo.
 */

const KEY_BYTES = 16;
const PREFIX_LEN = 8;

export function generateRawKey() {
  const random = randomBytes(KEY_BYTES).toString('base64url');
  return `rk_${random}`;
}

export function prefixForKey(plaintext) {
  return String(plaintext || '').slice(0, PREFIX_LEN);
}

export async function createKey({ organizationId, name, createdBy = null }) {
  if (!organizationId || !name) throw new Error('organizationId and name are required');
  const plaintext = generateRawKey();
  const prefix = prefixForKey(plaintext);
  const hashed = await bcrypt.hash(plaintext, 12);
  const { rows } = await query(
    `INSERT INTO licensee_api_keys (organization_id, name, prefix, hashed_key, created_by)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, organization_id, name, prefix, created_at, created_by, last_used_at, revoked_at`,
    [organizationId, String(name).trim(), prefix, hashed, createdBy]
  );
  return { row: rows[0], plaintext };
}

export async function listForOrganization(organizationId, { includeRevoked = false } = {}) {
  if (!organizationId) return [];
  const { rows } = await query(
    `SELECT id, organization_id, name, prefix, created_at, created_by, last_used_at, revoked_at
     FROM licensee_api_keys
     WHERE organization_id = $1
       ${includeRevoked ? '' : 'AND revoked_at IS NULL'}
     ORDER BY created_at DESC
     LIMIT 200`,
    [organizationId]
  );
  return rows;
}

/**
 * Find an active key by its plaintext presented in the Authorization
 * header. We narrow by prefix first (indexed lookup), then bcrypt-
 * compare the candidates. Returns null on miss; updates last_used_at
 * on hit.
 */
export async function findActiveKeyByPlaintext(plaintext) {
  const trimmed = String(plaintext || '').trim();
  if (!trimmed.startsWith('rk_')) return null;
  const prefix = prefixForKey(trimmed);
  const { rows } = await query(
    `SELECT * FROM licensee_api_keys
     WHERE prefix = $1
       AND revoked_at IS NULL
     ORDER BY created_at DESC
     LIMIT 5`,
    [prefix]
  );
  for (const row of rows) {
    // eslint-disable-next-line no-await-in-loop
    const ok = await bcrypt.compare(trimmed, row.hashed_key);
    if (ok) {
      // Best-effort touch; if it fails (DB hiccup) auth still succeeds.
      query(
        `UPDATE licensee_api_keys SET last_used_at = NOW() WHERE id = $1`,
        [row.id]
      ).catch(() => {});
      return row;
    }
  }
  return null;
}

export async function revokeKey(id, organizationId) {
  if (!id || !organizationId) return null;
  const { rows } = await query(
    `UPDATE licensee_api_keys
       SET revoked_at = NOW()
     WHERE id = $1
       AND organization_id = $2
       AND revoked_at IS NULL
     RETURNING id, organization_id, name, prefix, created_at, revoked_at`,
    [id, organizationId]
  );
  return rows[0] || null;
}

export function publicRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    prefix: row.prefix,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at || null,
    revokedAt: row.revoked_at || null,
    revoked: Boolean(row.revoked_at),
  };
}
