import { query } from '../config/database.js';

export async function listSessionsForOrg(organizationId) {
  const { rows } = await query(
    `SELECT * FROM pulse_sessions WHERE organization_id = $1 ORDER BY created_at DESC`,
    [organizationId]
  );
  return rows;
}

export async function createSession(organizationId, name, status = 'draft') {
  const { rows } = await query(
    `INSERT INTO pulse_sessions (organization_id, name, status) VALUES ($1, $2, $3) RETURNING *`,
    [organizationId, name, status]
  );
  return rows[0];
}

export async function updateSessionStatus(id, organizationId, status) {
  const closedAt = status === 'closed' ? new Date() : null;
  const { rows } = await query(
    `UPDATE pulse_sessions SET status = $1, closed_at = COALESCE($2, closed_at)
     WHERE id = $3 AND organization_id = $4
     RETURNING *`,
    [status, closedAt, id, organizationId]
  );
  return rows[0] || null;
}

export async function getActiveSessionForOrg(organizationId) {
  const { rows } = await query(
    `SELECT * FROM pulse_sessions
     WHERE organization_id = $1 AND status = 'active'
     ORDER BY created_at DESC LIMIT 1`,
    [organizationId]
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
