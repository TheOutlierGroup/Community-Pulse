import { randomBytes } from 'crypto';
import { query } from '../config/database.js';

export const WEBHOOK_EVENTS = [
  'lead.created',
  'lead.won',
  'lead.lost',
  'project.created',
  'project.status_changed',
  'project.over_budget',
];

function generateSigningSecret() {
  return `whsec_${randomBytes(24).toString('hex')}`;
}

export async function createEndpoint(organizationId, { url, description, events = [], createdBy = null }) {
  const validEvents = events.filter((e) => WEBHOOK_EVENTS.includes(e));
  const { rows } = await query(
    `INSERT INTO webhook_endpoints (organization_id, url, description, events, signing_secret, created_by)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6)
     RETURNING *`,
    [organizationId, String(url).trim(), description || null, JSON.stringify(validEvents), generateSigningSecret(), createdBy || null]
  );
  return rows[0];
}

export async function getEndpoint(id) {
  const { rows } = await query(`SELECT * FROM webhook_endpoints WHERE id = $1`, [id]);
  return rows[0] || null;
}

export async function listEndpoints(organizationId) {
  const { rows } = await query(
    `SELECT * FROM webhook_endpoints WHERE organization_id = $1 ORDER BY created_at ASC`,
    [organizationId]
  );
  return rows;
}

export async function updateEndpoint(id, { url, description, events, isActive } = {}) {
  const validEvents = Array.isArray(events) ? events.filter((e) => WEBHOOK_EVENTS.includes(e)) : null;
  const { rows } = await query(
    `UPDATE webhook_endpoints
     SET url         = COALESCE($2, url),
         description = COALESCE($3, description),
         events      = CASE WHEN $4::text IS NOT NULL THEN $4::jsonb ELSE events END,
         is_active   = COALESCE($5, is_active),
         updated_at  = NOW()
     WHERE id = $1
     RETURNING *`,
    [id, url ? String(url).trim() : null, description !== undefined ? description : null, validEvents ? JSON.stringify(validEvents) : null, isActive != null ? Boolean(isActive) : null]
  );
  return rows[0] || null;
}

export async function deleteEndpoint(id) {
  await query(`DELETE FROM webhook_endpoints WHERE id = $1`, [id]);
}

export async function listActiveEndpointsForEvent(organizationId, eventName) {
  const { rows } = await query(
    `SELECT * FROM webhook_endpoints
     WHERE organization_id = $1
       AND is_active = TRUE
       AND events @> $2::jsonb`,
    [organizationId, JSON.stringify([eventName])]
  );
  return rows;
}

export async function logDispatch(webhookEndpointId, eventName, payload, { attempt = 1, status, responseStatus = null, errorDetail = null, dispatchedAt = null } = {}) {
  await query(
    `INSERT INTO webhook_dispatch_log
       (webhook_endpoint_id, event_name, payload, attempt, status, response_status, error_detail, dispatched_at)
     VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7, $8)`,
    [webhookEndpointId, eventName, JSON.stringify(payload), attempt, status, responseStatus || null, errorDetail || null, dispatchedAt || new Date()]
  );
}
