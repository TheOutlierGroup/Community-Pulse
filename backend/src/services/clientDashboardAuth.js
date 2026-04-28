import crypto from 'crypto';
import { query } from '../config/database.js';

function hashToken(rawToken) {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

function normalizeEmail(email) {
  return String(email || '')
    .trim()
    .toLowerCase();
}

function maxDashboardTokenHours() {
  const raw = Number.parseInt(String(process.env.CLIENT_DASHBOARD_TOKEN_MAX_HOURS || '24'), 10);
  if (!Number.isFinite(raw) || raw <= 0 || raw > 24) return 24;
  return raw;
}

export async function issueDashboardLoginToken({
  organizationId,
  projectSessionId = null,
  contactEmail,
  issuedByUserId = null,
}) {
  const email = normalizeEmail(contactEmail);
  if (!email) throw new Error('contactEmail is required');
  const rawToken = crypto.randomUUID();
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + maxDashboardTokenHours() * 60 * 60 * 1000);
  const { rows } = await query(
    `INSERT INTO client_dashboard_login_tokens (
       organization_id,
       project_session_id,
       contact_email,
       token_hash,
       expires_at,
       issued_by_user_id
     ) VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [organizationId, projectSessionId, email, tokenHash, expiresAt, issuedByUserId]
  );
  return { token: rawToken, record: rows[0] };
}

export async function consumeDashboardLoginToken({
  token,
  organizationId,
  contactEmail,
}) {
  const tokenHash = hashToken(String(token || '').trim());
  const email = normalizeEmail(contactEmail);
  if (!tokenHash || !email) return null;
  const { rows } = await query(
    `UPDATE client_dashboard_login_tokens
     SET consumed_at = NOW()
     WHERE token_hash = $1
       AND organization_id = $2
       AND contact_email = $3
       AND consumed_at IS NULL
       AND expires_at > NOW()
     RETURNING *`,
    [tokenHash, organizationId, email]
  );
  return rows[0] || null;
}
