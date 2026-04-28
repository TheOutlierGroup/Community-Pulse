import { query } from '../config/database.js';

export async function createStatusEvent({
  sessionId,
  organizationId,
  actorUserId = null,
  fromStatus = null,
  toStatus,
  metadata = {},
}) {
  const safeMetadata =
    metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {};
  const { rows } = await query(
    `INSERT INTO pulse_session_status_events (
       session_id,
       organization_id,
       actor_user_id,
       from_status,
       to_status,
       metadata
     ) VALUES ($1, $2, $3, $4, $5, $6::jsonb)
     RETURNING *`,
    [sessionId, organizationId, actorUserId, fromStatus, toStatus, JSON.stringify(safeMetadata)]
  );
  return rows[0];
}

export async function listStatusEventsForSession(sessionId) {
  const { rows } = await query(
    `SELECT *
     FROM pulse_session_status_events
     WHERE session_id = $1
     ORDER BY changed_at DESC`,
    [sessionId]
  );
  return rows;
}
