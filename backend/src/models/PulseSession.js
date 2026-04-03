import { query } from '../config/database.js';

export async function listSessionsForOrg(organizationId) {
  const { rows } = await query(
    `SELECT * FROM pulse_sessions WHERE organization_id = $1 ORDER BY created_at DESC`,
    [organizationId]
  );
  return rows;
}

export async function createSession(organizationId, name, status = 'draft', audience = 'staff') {
  const aud = audience === 'manager' ? 'manager' : 'staff';
  const { rows } = await query(
    `INSERT INTO pulse_sessions (organization_id, name, status, audience) VALUES ($1, $2, $3, $4) RETURNING *`,
    [organizationId, name, status, aud]
  );
  return rows[0];
}

export async function updateSessionStatus(id, organizationId, status) {
  const existing = await getSessionById(id, organizationId);
  if (!existing) return null;
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
    return rows[0] || null;
  }
  const closedAt = status === 'closed' ? new Date() : null;
  const { rows } = await query(
    `UPDATE pulse_sessions SET status = $1, closed_at = COALESCE($2, closed_at)
     WHERE id = $3 AND organization_id = $4
     RETURNING *`,
    [status, closedAt, id, organizationId]
  );
  return rows[0] || null;
}

export async function getActiveSessionForOrg(organizationId, audience = 'staff') {
  const aud = audience === 'manager' ? 'manager' : 'staff';
  const { rows } = await query(
    `SELECT * FROM pulse_sessions
     WHERE organization_id = $1 AND status = 'active' AND audience = $2
     ORDER BY created_at DESC LIMIT 1`,
    [organizationId, aud]
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

/**
 * Personal invite links join the org's active Pulse wave when one exists; otherwise use (or reactivate)
 * a dedicated link-invite session so recipients are never blocked by "no active session".
 */
export async function resolveSessionForPulseLink(organizationId, audience = 'staff') {
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
    throw new Error('Could not resolve Pulse session for link');
  }
  if (linkSess.status !== 'active') {
    const updated = await updateSessionStatus(linkSess.id, organizationId, 'active');
    return updated || (await getSessionById(linkSess.id, organizationId));
  }
  return linkSess;
}
