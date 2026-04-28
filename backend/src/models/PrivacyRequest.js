import { query } from '../config/database.js';

function normalizeRequestType(type) {
  const raw = String(type || '')
    .trim()
    .toLowerCase();
  if (raw === 'deletion') return 'deletion';
  return 'access';
}

function normalizeStatus(status) {
  const raw = String(status || '')
    .trim()
    .toLowerCase();
  if (['received', 'in_review', 'fulfilled', 'denied', 'cancelled'].includes(raw)) return raw;
  return null;
}

export async function createPrivacyRequest({
  organizationId,
  requestType,
  subjectEmail,
  subjectName = null,
  requestDetails = null,
  createdByUserId = null,
  metadata = {},
}) {
  const safeMetadata =
    metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {};
  const { rows } = await query(
    `INSERT INTO privacy_requests (
       organization_id,
       request_type,
       subject_email,
       subject_name,
       request_details,
       created_by_user_id,
       updated_by_user_id,
       metadata
     ) VALUES ($1, $2, lower($3), $4, $5, $6, $6, $7::jsonb)
     RETURNING *`,
    [
      organizationId,
      normalizeRequestType(requestType),
      String(subjectEmail || '').trim(),
      subjectName,
      requestDetails,
      createdByUserId,
      JSON.stringify(safeMetadata),
    ]
  );
  return rows[0];
}

export async function listPrivacyRequestsForOrg(organizationId, { status = null, limit = 200, offset = 0 } = {}) {
  const cappedLimit = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 500) : 200;
  const safeOffset = Number.isInteger(offset) && offset >= 0 ? offset : 0;
  const normalizedStatus = normalizeStatus(status);
  const params = [organizationId, cappedLimit, safeOffset];
  let where = `organization_id = $1`;
  if (normalizedStatus) {
    where += ` AND status = $4`;
    params.push(normalizedStatus);
  }
  const { rows } = await query(
    `SELECT *
     FROM privacy_requests
     WHERE ${where}
     ORDER BY created_at DESC
     LIMIT $2 OFFSET $3`,
    params
  );
  return rows;
}

export async function updatePrivacyRequest(id, organizationId, updates = {}, updatedByUserId = null) {
  const parts = [];
  const values = [];
  let n = 1;
  if ('status' in updates) {
    const nextStatus = normalizeStatus(updates.status);
    if (!nextStatus) throw new Error('Invalid status');
    parts.push(`status = $${n++}`);
    values.push(nextStatus);
    if (nextStatus === 'fulfilled') {
      parts.push(`fulfilled_at = NOW()`);
    }
  }
  if ('identityVerified' in updates) {
    parts.push(`identity_verified = $${n++}`);
    values.push(Boolean(updates.identityVerified));
  }
  if ('requestDetails' in updates) {
    parts.push(`request_details = $${n++}`);
    values.push(updates.requestDetails ?? null);
  }
  if ('metadata' in updates && updates.metadata && typeof updates.metadata === 'object') {
    parts.push(`metadata = COALESCE(metadata, '{}'::jsonb) || $${n++}::jsonb`);
    values.push(JSON.stringify(updates.metadata));
  }
  if (parts.length === 0) return null;
  parts.push(`updated_by_user_id = $${n++}`);
  values.push(updatedByUserId);
  parts.push(`updated_at = NOW()`);
  values.push(id, organizationId);
  const { rows } = await query(
    `UPDATE privacy_requests
     SET ${parts.join(', ')}
     WHERE id = $${n++} AND organization_id = $${n++}
     RETURNING *`,
    values
  );
  return rows[0] || null;
}
