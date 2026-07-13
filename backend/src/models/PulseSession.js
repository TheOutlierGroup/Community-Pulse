import { query } from '../config/database.js';
import * as PulseSessionStatusEvent from './PulseSessionStatusEvent.js';
import {
  PULSE_STAGE_MID,
  PULSE_STAGE_POST,
  PULSE_STAGE_PRE,
  normalizePulseStage,
} from '../services/pulseStage.js';

export async function listSessionsForOrg(organizationId) {
  const { rows } = await query(
    `SELECT * FROM pulse_sessions WHERE organization_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC`,
    [organizationId]
  );
  return rows;
}

export function normalizeSessionPurpose(sessionPurpose) {
  const raw = String(sessionPurpose || 'standard')
    .trim()
    .toLowerCase();
  if (raw === 'link_invite') return 'link_invite';
  if (raw === 'pre_project') return 'pre_project';
  if (raw === 'completed_project') return 'completed_project';
  if (raw === 'during_project') return 'during_project';
  return 'standard';
}

export function stageFromSessionPurpose(sessionPurpose, fallback = PULSE_STAGE_PRE) {
  const purpose = normalizeSessionPurpose(sessionPurpose);
  if (purpose === 'pre_project') return PULSE_STAGE_PRE;
  if (purpose === 'during_project') return PULSE_STAGE_MID;
  if (purpose === 'completed_project') return PULSE_STAGE_POST;
  return normalizePulseStage(fallback);
}

export async function createSession(
  organizationId,
  name,
  status = 'draft',
  audience = 'staff',
  sessionPurpose = 'standard'
) {
  const normalizedStatus = ['draft', 'active', 'paused', 'closed'].includes(status) ? status : 'draft';
  const aud = audience === 'manager' ? 'manager' : 'staff';
  const purpose = normalizeSessionPurpose(sessionPurpose);
  const { rows } = await query(
    `INSERT INTO pulse_sessions (organization_id, name, status, audience, session_purpose)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [organizationId, name, normalizedStatus, aud, purpose]
  );
  await PulseSessionStatusEvent.createStatusEvent({
    sessionId: rows[0].id,
    organizationId,
    fromStatus: null,
    toStatus: normalizedStatus,
    metadata: { source: 'createSession' },
  });
  return rows[0];
}

export async function updateSessionStatus(id, organizationId, status, options = {}) {
  const actorUserId = options?.actorUserId || null;
  const metadata = options?.metadata || {};
  const existing = await getSessionById(id, organizationId);
  if (!existing) return null;
  const nextStatus = ['draft', 'active', 'paused', 'closed'].includes(status) ? status : null;
  if (!nextStatus) return null;
  if (status === 'active') {
    await query(
      `UPDATE pulse_sessions SET status = 'closed', closed_at = COALESCE(closed_at, NOW())
       WHERE organization_id = $1 AND audience = $2 AND status = 'active' AND id != $3`,
      [organizationId, existing.audience, id]
    );
    const { rows } = await query(
      `UPDATE pulse_sessions SET status = 'active', closed_at = NULL
       WHERE id = $1 AND organization_id = $2
       RETURNING *`,
      [id, organizationId]
    );
    const updated = rows[0] || null;
    if (updated && existing.status !== updated.status) {
      await PulseSessionStatusEvent.createStatusEvent({
        sessionId: updated.id,
        organizationId,
        actorUserId,
        fromStatus: existing.status,
        toStatus: updated.status,
        metadata: { ...metadata, source: 'updateSessionStatus' },
      });
    }
    return updated;
  }
  const closedAt = status === 'closed' ? new Date() : null;
  const { rows } = await query(
    `UPDATE pulse_sessions SET status = $1, closed_at = COALESCE($2, closed_at)
     WHERE id = $3 AND organization_id = $4
     RETURNING *`,
    [status, closedAt, id, organizationId]
  );
  const updated = rows[0] || null;
  if (updated && existing.status !== updated.status) {
    await PulseSessionStatusEvent.createStatusEvent({
      sessionId: updated.id,
      organizationId,
      actorUserId,
      fromStatus: existing.status,
      toStatus: updated.status,
      metadata: { ...metadata, source: 'updateSessionStatus' },
    });
  }
  return updated;
}

export async function getActiveSessionForOrg(organizationId, audience = 'staff') {
  const aud = audience === 'manager' ? 'manager' : 'staff';
  const { rows } = await query(
    `SELECT * FROM pulse_sessions
     WHERE organization_id = $1 AND status = 'active' AND audience = $2 AND deleted_at IS NULL
     ORDER BY created_at DESC LIMIT 1`,
    [organizationId, aud]
  );
  return rows[0] || null;
}

/**
 * Soft-deletes a During checkpoint so it disappears from the Point in Time
 * selector and dashboards while keeping the row (and any responses that
 * reference it) intact for audit/recovery. Only During checkpoints are
 * deletable — Pre/Post are singleton system sessions.
 */
export async function softDeleteDuringSession(id, organizationId, options = {}) {
  const actorUserId = options?.actorUserId || null;
  const existing = await getSessionById(id, organizationId);
  if (!existing || existing.deleted_at) return null;
  if (normalizeSessionPurpose(existing.session_purpose) !== 'during_project') return null;

  const { rows } = await query(
    `UPDATE pulse_sessions
     SET deleted_at = NOW(),
         status = CASE WHEN status = 'active' THEN 'closed' ELSE status END,
         closed_at = COALESCE(closed_at, NOW())
     WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL
     RETURNING *`,
    [id, organizationId]
  );
  const updated = rows[0] || null;
  if (updated) {
    await PulseSessionStatusEvent.createStatusEvent({
      sessionId: updated.id,
      organizationId,
      actorUserId,
      fromStatus: existing.status,
      toStatus: 'deleted',
      metadata: { ...(options?.metadata || {}), source: 'softDeleteDuringSession' },
    });
  }
  return updated;
}

/**
 * Cosmetic display-date override for During checkpoints, whose created_at
 * otherwise just reflects when the checkpoint was opened rather than the
 * real mid-engagement date it represents. Purely a label — never used for
 * filtering or cutoffs. Pre/Post dates are sourced from the client's
 * contract (licence_config.contract_start/contract_end) and are not
 * editable here, so this is restricted to During sessions only.
 */
export async function setLabelDate(id, organizationId, labelDate) {
  const { rows } = await query(
    `UPDATE pulse_sessions
     SET label_date = $3
     WHERE id = $1 AND organization_id = $2 AND session_purpose = 'during_project'
     RETURNING *`,
    [id, organizationId, labelDate]
  );
  return rows[0] || null;
}

export async function getSessionById(id, organizationId) {
  const { rows } = await query(
    `SELECT * FROM pulse_sessions WHERE id = $1 AND organization_id = $2`,
    [id, organizationId]
  );
  return rows[0] || null;
}

export async function getSessionByIdAnyOrg(id) {
  const { rows } = await query(`SELECT * FROM pulse_sessions WHERE id = $1`, [id]);
  return rows[0] || null;
}

export async function setRespondentCapOverride(id, organizationId, cap) {
  const normalized = cap == null
    ? null
    : Number.isFinite(cap) && cap >= 0
      ? Math.floor(cap)
      : null;
  const { rows } = await query(
    `UPDATE pulse_sessions
     SET respondent_cap_override = $3
     WHERE id = $1 AND organization_id = $2
     RETURNING *`,
    [id, organizationId, normalized]
  );
  return rows[0] || null;
}

/**
 * Counts respondents who have actually submitted a completed response for
 * a session, across both authenticated employees and link-invite
 * respondents. Used by INF-05 to compare against the effective cap.
 */
export async function countCompletedRespondentsForSession(sessionId) {
  const { rows } = await query(
    `SELECT
       (SELECT COUNT(*)::int
          FROM employee_responses
         WHERE session_id = $1 AND completed_at IS NOT NULL) AS employee_completed,
       (SELECT COUNT(*)::int
          FROM pulse_link_responses
         WHERE session_id = $1 AND completed_at IS NOT NULL) AS link_completed`,
    [sessionId]
  );
  const employeeCompleted = rows[0]?.employee_completed ?? 0;
  const linkCompleted = rows[0]?.link_completed ?? 0;
  return {
    total: employeeCompleted + linkCompleted,
    employee: employeeCompleted,
    link: linkCompleted,
  };
}

export async function hasCompletedLinkResponseForInvite(inviteId, sessionId) {
  if (!inviteId || !sessionId) return false;
  const { rows } = await query(
    `SELECT 1 FROM pulse_link_responses
     WHERE invite_id = $1 AND session_id = $2 AND completed_at IS NOT NULL
     LIMIT 1`,
    [inviteId, sessionId]
  );
  return rows.length > 0;
}

export async function hasCompletedEmployeeResponseForUser(userId, sessionId) {
  if (!userId || !sessionId) return false;
  const { rows } = await query(
    `SELECT 1 FROM employee_responses
     WHERE user_id = $1 AND session_id = $2 AND completed_at IS NOT NULL
     LIMIT 1`,
    [userId, sessionId]
  );
  return rows.length > 0;
}

export async function getLatestSessionForOrgByPurpose(
  organizationId,
  audience = 'staff',
  sessionPurpose = 'standard'
) {
  const aud = audience === 'manager' ? 'manager' : 'staff';
  const purpose = normalizeSessionPurpose(sessionPurpose);
  const { rows } = await query(
    `SELECT * FROM pulse_sessions
     WHERE organization_id = $1 AND audience = $2 AND session_purpose = $3
     ORDER BY created_at DESC
     LIMIT 1`,
    [organizationId, aud, purpose]
  );
  return rows[0] || null;
}

export async function getLinkInviteTemplateSession(organizationId, audience = 'staff') {
  const aud = audience === 'manager' ? 'manager' : 'staff';
  const { rows } = await query(
    `SELECT * FROM pulse_sessions
     WHERE organization_id = $1 AND audience = $2 AND session_purpose = 'link_invite'
     ORDER BY created_at ASC
     LIMIT 1`,
    [organizationId, aud]
  );
  return rows[0] || null;
}

export async function createLinkInviteSession(organizationId, audience = 'staff') {
  const aud = audience === 'manager' ? 'manager' : 'staff';
  const { rows } = await query(
    `INSERT INTO pulse_sessions (organization_id, name, status, audience, session_purpose)
     VALUES ($1, 'Survey via personal link', 'active', $2, 'link_invite')
     RETURNING *`,
    [organizationId, aud]
  );
  return rows[0];
}

function stagePurposeForLink(stage) {
  const normalized = normalizePulseStage(stage);
  if (normalized === PULSE_STAGE_PRE) return 'pre_project';
  if (normalized === PULSE_STAGE_POST) return 'completed_project';
  return 'during_project';
}

function fallbackSessionNameForLink(stage) {
  const normalized = normalizePulseStage(stage);
  if (normalized === PULSE_STAGE_PRE) return 'Pre checkpoint (link)';
  if (normalized === PULSE_STAGE_POST) return 'Post checkpoint (link)';
  return 'During checkpoint (link)';
}

/**
 * Personal invite links must resolve to a session that matches the invite stage.
 * This keeps pre/mid/post responses aligned with the same timepoint buckets used by dashboards.
 */
export async function resolveSessionForPulseLink(organizationId, audience = 'staff', stage = PULSE_STAGE_PRE) {
  const normalizedStage = normalizePulseStage(stage);
  const expectedPurpose = stagePurposeForLink(normalizedStage);

  const latestStageSession = await getLatestSessionForOrgByPurpose(
    organizationId,
    audience,
    expectedPurpose
  );
  if (latestStageSession) return latestStageSession;

  const active = await getActiveSessionForOrg(organizationId, audience);
  if (active && normalizePulseStage(stageFromSessionPurpose(active.session_purpose, normalizedStage)) === normalizedStage) {
    return active;
  }

  if (normalizedStage === PULSE_STAGE_MID) {
    const linkSession = await getLinkInviteTemplateSession(organizationId, audience);
    if (linkSession) return linkSession;
  }

  return createSession(
    organizationId,
    fallbackSessionNameForLink(normalizedStage),
    'draft',
    audience,
    expectedPurpose
  );
}

/**
 * Legacy helper for callers that still use link-invite template sessions directly.
 */
export async function resolveLegacyLinkInviteSession(organizationId, audience = 'staff') {
  const active = await getActiveSessionForOrg(organizationId, audience);
  if (active) return active;

  let linkSess = await getLinkInviteTemplateSession(organizationId, audience);
  if (!linkSess) {
    try {
      linkSess = await createLinkInviteSession(organizationId, audience);
    } catch (e) {
      if (e && e.code === '23505') {
        linkSess = await getLinkInviteTemplateSession(organizationId, audience);
      } else {
        throw e;
      }
    }
  }
  if (!linkSess) {
    throw new Error('Could not resolve Rhythm Engine session for link');
  }
  if (linkSess.status !== 'active') {
    const updated = await updateSessionStatus(linkSess.id, organizationId, 'active');
    return updated || (await getSessionById(linkSess.id, organizationId));
  }
  return linkSess;
}
