import { query } from '../config/database.js';

/**
 * INF-03 canonical action vocabulary. Keep this list close to the schema
 * — every value is what shows up in the audit feed UI, so renaming is
 * cheap upfront and expensive after data lands. Group prefixes (`org.`,
 * `user.`, `licence.`, etc.) make filtering trivial later.
 */
export const AUDIT_ACTIONS = Object.freeze({
  ORG_CREATE: 'org.create',
  ORG_UPDATE: 'org.update',
  ORG_DELETE: 'org.delete',
  ORG_LOGO_UPLOAD: 'org.logo.upload',
  ORG_LOGO_DELETE: 'org.logo.delete',

  USER_INVITE_SEND: 'user.invite.send',
  USER_INVITE_RESEND: 'user.invite.resend',
  USER_UPDATE: 'user.update',
  USER_DEACTIVATE: 'user.deactivate',
  USER_PASSWORD_RESET_BY_ADMIN: 'user.password_reset_by_admin',

  LICENCE_CONFIG_UPDATE: 'licence.config.update',
  LICENCE_EXPIRY_SWEEP: 'licence.expiry.sweep',

  PULSE_SESSION_CREATE: 'pulse.session.create',
  PULSE_DURING_CHECKPOINT_OPEN: 'pulse.during_checkpoint.open',
  PULSE_DURING_CHECKPOINT_DELETE: 'pulse.during_checkpoint.delete',
  PULSE_RESPONDENT_CAP_OVERRIDE: 'pulse.respondent_cap.override',
  PULSE_SESSION_LABEL_DATE_UPDATE: 'pulse.session.label_date.update',

  ASSESSMENT_CONSUME: 'assessment.consume',
  ASSESSMENT_REFUND: 'assessment.refund',

  STATUS_INCIDENT_CREATE: 'status_incident.create',
  STATUS_INCIDENT_UPDATE: 'status_incident.update',
  STATUS_INCIDENT_RESOLVE: 'status_incident.resolve',
  STATUS_INCIDENT_DELETE: 'status_incident.delete',

  LICENSEE_DATA_EXPORT_DOWNLOAD: 'licensee.data_export.download',
  LICENSEE_OFFBOARD_REQUEST: 'licensee.offboard.request',
  LICENSEE_OFFBOARD_CANCEL: 'licensee.offboard.cancel',
  LICENSEE_OFFBOARD_PURGE: 'licensee.offboard.purge',

  SUPPORT_TASK_CREATE: 'support_task.create',
  SUPPORT_IMPERSONATE_BEGIN: 'support.impersonate.begin',
  SUPPORT_IMPERSONATE_BLOCKED_WRITE: 'support.impersonate.blocked_write',

  ANNOUNCEMENT_CREATE: 'announcement.create',
  ANNOUNCEMENT_UPDATE: 'announcement.update',
  ANNOUNCEMENT_DELETE: 'announcement.delete',

  API_KEY_CREATE: 'api_key.create',
  API_KEY_REVOKE: 'api_key.revoke',

  CRM_ORGANISATION_CREATE: 'crm.organisation.create',
  CRM_ORGANISATION_UPDATE: 'crm.organisation.update',
  CRM_ORGANISATION_DELETE: 'crm.organisation.delete',
  CRM_CONTACT_CREATE: 'crm.contact.create',
  CRM_CONTACT_UPDATE: 'crm.contact.update',
  CRM_CONTACT_DELETE: 'crm.contact.delete',
  CRM_NOTE_CREATE: 'crm.note.create',
  CRM_NOTE_DELETE: 'crm.note.delete',
  CRM_NOTE_COMMENT_CREATE: 'crm.note.comment.create',
  CRM_NOTE_COMMENT_DELETE: 'crm.note.comment.delete',
  CRM_TASK_CREATE: 'crm.task.create',
  CRM_TASK_UPDATE: 'crm.task.update',
  CRM_TASK_DELETE: 'crm.task.delete',
  CRM_ORGANISATION_LOGO_UPLOAD: 'crm.organisation.logo.upload',
  CRM_ORGANISATION_LOGO_DELETE: 'crm.organisation.logo.delete',
  CRM_ORGANISATION_PROMOTE: 'crm.organisation.promote',
  ORG_PROMOTED_FROM_PROSPECT: 'org.promoted_from_prospect',
});

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

/**
 * INF-03 fire-and-forget wrapper. Audit logging must NEVER cause a
 * primary mutation to fail — if the insert errors (DB hiccup, malformed
 * metadata, etc.) we log to console and return null. Use this in route
 * handlers; reserve `logAuditEvent` for callers that genuinely care
 * about the row (e.g. tests).
 */
export async function recordAuditEvent(input) {
  try {
    return await logAuditEvent(input);
  } catch (error) {
    console.error('Audit log write failed:', error?.message || error, {
      action: input?.action,
      targetType: input?.targetType,
      targetId: input?.targetId,
    });
    return null;
  }
}

/**
 * Build a request-aware audit recorder pre-populated with actor + IP +
 * user-agent so the call sites stay short and consistent. Returns a
 * function that takes the variable bits (action, target, metadata).
 */
export function auditFromRequest(req) {
  const actor = req?.user
    ? { id: req.user.id, role: req.user.role, organizationId: req.user.organizationId }
    : null;
  const ipAddress = req?.ip || null;
  const userAgent = req?.get?.('user-agent') || null;
  return function record({ action, targetType, targetId = null, targetOrganizationId = null, result = 'ok', metadata = {}, occurredAt = undefined }) {
    return recordAuditEvent({
      actor,
      action,
      targetType,
      targetId,
      targetOrganizationId,
      result,
      ipAddress,
      userAgent,
      metadata,
      ...(occurredAt !== undefined ? { occurredAt } : {}),
    });
  };
}

export function publicAuditEvent(row) {
  if (!row) return null;
  return {
    id: row.id,
    occurredAt: row.occurred_at,
    actorUserId: row.actor_user_id,
    actorRole: row.actor_role,
    actorOrganizationId: row.actor_organization_id,
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id,
    targetOrganizationId: row.target_organization_id,
    result: row.result,
    metadata: row.metadata || {},
  };
}

export async function listRecentAuditEvents({
  organizationId,
  limit = 100,
  offset = 0,
  action = null,
  targetId = null,
  targetType = null,
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
  if (targetId) {
    where += ` AND target_id = $${idx++}`;
    params.push(String(targetId));
  }
  if (targetType) {
    where += ` AND target_type = $${idx++}`;
    params.push(targetType);
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
