import { query } from '../config/database.js';

function normalizeText(value, fallback = null) {
  if (value == null) return fallback;
  const text = String(value).trim();
  return text || fallback;
}

function actorFields(actor) {
  if (!actor) return {};
  return {
    actorUserId: actor.id || null,
    actorRole: actor.role || null,
    actorOrganizationId: actor.organizationId || null,
  };
}

export async function logAuditEvent({
  occurredAt = new Date(),
  actor = null,
  action,
  targetType,
  targetId = null,
  targetOrganizationId = null,
  result = 'ok',
  ipAddress = null,
  userAgent = null,
  metadata = {},
}) {
  const normalizedAction = normalizeText(action);
  const normalizedTargetType = normalizeText(targetType);
  if (!normalizedAction || !normalizedTargetType) {
    throw new Error('action and targetType are required for audit events');
  }
  const { actorUserId, actorRole, actorOrganizationId } = actorFields(actor);
  const safeMetadata =
    metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {};

  const { rows } = await query(
    `INSERT INTO audit_events (
       occurred_at,
       actor_user_id,
       actor_role,
       actor_organization_id,
       action,
       target_type,
       target_id,
       target_organization_id,
       result,
       ip_address,
       user_agent,
       metadata
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb
     )
     RETURNING *`,
    [
      occurredAt,
      actorUserId,
      actorRole,
      actorOrganizationId,
      normalizedAction,
      normalizedTargetType,
      normalizeText(targetId),
      targetOrganizationId,
      normalizeText(result, 'ok'),
      normalizeText(ipAddress),
      normalizeText(userAgent),
      JSON.stringify(safeMetadata),
    ]
  );
  return rows[0];
}

export async function listRecentAuditEvents({
  organizationId,
  limit = 100,
  offset = 0,
  action = null,
}) {
  const cappedLimit = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 500) : 100;
  const safeOffset = Number.isInteger(offset) && offset >= 0 ? offset : 0;
  const params = [cappedLimit, safeOffset];
  let idx = 3;
  let where = 'WHERE 1=1';

  if (organizationId) {
    where += ` AND target_organization_id = $${idx++}`;
    params.push(organizationId);
  }
  if (action) {
    where += ` AND action = $${idx++}`;
    params.push(action);
  }

  const { rows } = await query(
    `SELECT *
     FROM audit_events
     ${where}
     ORDER BY occurred_at DESC
     LIMIT $1 OFFSET $2`,
    params
  );
  return rows;
}
