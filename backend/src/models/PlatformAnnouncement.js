import { query } from '../config/database.js';

export const AUDIENCES = ['all', 'platform', 'licensee'];

export async function createAnnouncement({
  title,
  body,
  audience = 'all',
  banner = true,
  emailOnPublish = false,
  expiresAt = null,
  createdBy = null,
}) {
  if (!AUDIENCES.includes(audience)) throw new Error(`audience must be one of ${AUDIENCES.join(', ')}`);
  const { rows } = await query(
    `INSERT INTO platform_announcements (title, body, audience, banner, email_on_publish, expires_at, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      String(title).trim().slice(0, 200),
      String(body).trim().slice(0, 8000),
      audience,
      Boolean(banner),
      Boolean(emailOnPublish),
      expiresAt ? new Date(expiresAt).toISOString() : null,
      createdBy,
    ]
  );
  return rows[0];
}

export async function updateAnnouncement(id, patch = {}) {
  const fields = [];
  const params = [id];
  const map = {
    title: 'title',
    body: 'body',
    audience: 'audience',
    banner: 'banner',
    expiresAt: 'expires_at',
  };
  for (const [key, column] of Object.entries(map)) {
    if (Object.prototype.hasOwnProperty.call(patch, key)) {
      params.push(key === 'expiresAt' && patch[key] ? new Date(patch[key]).toISOString() : patch[key]);
      fields.push(`${column} = $${params.length}`);
    }
  }
  if (!fields.length) return getById(id);
  fields.push('updated_at = NOW()');
  const { rows } = await query(
    `UPDATE platform_announcements SET ${fields.join(', ')} WHERE id = $1 RETURNING *`,
    params
  );
  return rows[0] || null;
}

export async function deleteAnnouncement(id) {
  if (!id) return null;
  const { rows } = await query(
    `DELETE FROM platform_announcements WHERE id = $1 RETURNING *`,
    [id]
  );
  return rows[0] || null;
}

export async function getById(id) {
  if (!id) return null;
  const { rows } = await query(
    `SELECT * FROM platform_announcements WHERE id = $1`,
    [id]
  );
  return rows[0] || null;
}

export async function listForAdmin({ limit = 100 } = {}) {
  const { rows } = await query(
    `SELECT * FROM platform_announcements ORDER BY published_at DESC LIMIT $1`,
    [Math.min(Math.max(Number.isInteger(limit) ? limit : 100, 1), 500)]
  );
  return rows;
}

/**
 * Active banner announcements for the given audience. Includes
 * audience='all' rows in every list. Excludes anything past its
 * expires_at, so once an announcement is configured with a TTL the
 * banner clears itself automatically.
 */
export async function listActiveForAudience(audience) {
  const { rows } = await query(
    `SELECT * FROM platform_announcements
     WHERE banner = TRUE
       AND (expires_at IS NULL OR expires_at > NOW())
       AND (audience = 'all' OR audience = $1)
     ORDER BY published_at DESC
     LIMIT 5`,
    [audience]
  );
  return rows;
}

export async function markEmailSent(id, recipientsCount) {
  const { rows } = await query(
    `UPDATE platform_announcements
       SET email_sent_at = NOW(),
           email_recipients_count = $2,
           updated_at = NOW()
     WHERE id = $1
       AND email_sent_at IS NULL
     RETURNING *`,
    [id, recipientsCount]
  );
  return rows[0] || null;
}

export function publicAnnouncement(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    audience: row.audience,
    banner: Boolean(row.banner),
    publishedAt: row.published_at,
    expiresAt: row.expires_at || null,
    emailOnPublish: Boolean(row.email_on_publish),
    emailSentAt: row.email_sent_at || null,
    emailRecipientsCount: row.email_recipients_count || null,
    createdBy: row.created_by || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
