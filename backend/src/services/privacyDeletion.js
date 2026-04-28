import { query } from '../config/database.js';

export async function createDeletionRequest({
  organizationId,
  requestedByUserId,
  reason,
  targetType,
  targetId,
}) {
  const { rows } = await query(
    `INSERT INTO privacy_deletion_requests (
       organization_id,
       requested_by_user_id,
       reason,
       target_type,
       target_id,
       status
     ) VALUES ($1, $2, $3, $4, $5, 'requested')
     RETURNING *`,
    [organizationId, requestedByUserId, reason, targetType, targetId]
  );
  return rows[0];
}

export async function completeDeletionRequest(id, { status, summary }) {
  const { rows } = await query(
    `UPDATE privacy_deletion_requests
     SET status = $2,
         result_summary = $3,
         completed_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [id, status, summary || null]
  );
  return rows[0] || null;
}

async function anonymizeInvite(inviteId, organizationId) {
  const { rowCount } = await query(
    `UPDATE pulse_link_invites
     SET email = CONCAT('anonymized+', id::text, '@redacted.local'),
         display_name = 'Anonymized Participant',
         updated_at = NOW()
     WHERE id = $1 AND organization_id = $2`,
    [inviteId, organizationId]
  );
  return rowCount || 0;
}

async function anonymizeOrgInvites(organizationId) {
  const { rowCount } = await query(
    `UPDATE pulse_link_invites
     SET email = CONCAT('anonymized+', id::text, '@redacted.local'),
         display_name = 'Anonymized Participant',
         updated_at = NOW()
     WHERE organization_id = $1`,
    [organizationId]
  );
  return rowCount || 0;
}

export async function runManualDeletion({
  organizationId,
  targetType,
  targetId,
  legalHold = false,
}) {
  if (legalHold) {
    return { status: 'blocked', summary: 'blocked_by_legal_hold', rowsChanged: 0 };
  }
  if (targetType === 'invite') {
    const rowsChanged = await anonymizeInvite(targetId, organizationId);
    return { status: 'completed', summary: `anonymized_invite:${rowsChanged}`, rowsChanged };
  }
  if (targetType === 'organization') {
    const rowsChanged = await anonymizeOrgInvites(organizationId);
    return { status: 'completed', summary: `anonymized_org_invites:${rowsChanged}`, rowsChanged };
  }
  return { status: 'failed', summary: 'unsupported_target_type', rowsChanged: 0 };
}
