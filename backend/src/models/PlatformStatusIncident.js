import { query } from '../config/database.js';

export const SEVERITIES = ['maintenance', 'minor', 'major', 'critical'];

function normalizeComponents(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((s) => String(s || '').trim())
    .filter(Boolean)
    .slice(0, 12);
}

export async function createIncident({ title, body, severity, components = [], createdBy = null }) {
  const safeSeverity = SEVERITIES.includes(severity) ? severity : 'maintenance';
  const safeComponents = normalizeComponents(components);
  const { rows } = await query(
    `INSERT INTO platform_status_incidents
       (title, body, severity, components, created_by)
     VALUES ($1, $2, $3, $4::text[], $5)
     RETURNING *`,
    [String(title || '').trim(), String(body || '').trim(), safeSeverity, safeComponents, createdBy]
  );
  return rows[0] || null;
}

export async function updateIncident(id, patch = {}) {
  if (!id) return null;
  const cols = [];
  const vals = [];
  let idx = 1;
  if (patch.title !== undefined) { cols.push(`title = $${idx++}`); vals.push(String(patch.title || '').trim()); }
  if (patch.body !== undefined) { cols.push(`body = $${idx++}`); vals.push(String(patch.body || '').trim()); }
  if (patch.severity !== undefined) {
    const sev = SEVERITIES.includes(patch.severity) ? patch.severity : 'maintenance';
    cols.push(`severity = $${idx++}`); vals.push(sev);
  }
  if (patch.components !== undefined) {
    cols.push(`components = $${idx++}::text[]`);
    vals.push(normalizeComponents(patch.components));
  }
  if (patch.resolvedAt !== undefined) {
    cols.push(`resolved_at = $${idx++}`);
    vals.push(patch.resolvedAt === null ? null : new Date(patch.resolvedAt).toISOString());
  }
  if (cols.length === 0) return getIncidentById(id);
  cols.push(`updated_at = NOW()`);
  vals.push(id);
  const { rows } = await query(
    `UPDATE platform_status_incidents
     SET ${cols.join(', ')}
     WHERE id = $${idx}
     RETURNING *`,
    vals
  );
  return rows[0] || null;
}

export async function getIncidentById(id) {
  if (!id) return null;
  const { rows } = await query(
    `SELECT * FROM platform_status_incidents WHERE id = $1`,
    [id]
  );
  return rows[0] || null;
}

export async function listActiveIncidents() {
  const { rows } = await query(
    `SELECT * FROM platform_status_incidents
     WHERE resolved_at IS NULL
     ORDER BY started_at DESC`
  );
  return rows;
}

export async function listIncidents({ limit = 50, includeResolved = true } = {}) {
  const cappedLimit = Math.min(Math.max(Number.isInteger(limit) ? limit : 50, 1), 200);
  if (includeResolved) {
    const { rows } = await query(
      `SELECT * FROM platform_status_incidents
       ORDER BY started_at DESC
       LIMIT $1`,
      [cappedLimit]
    );
    return rows;
  }
  return listActiveIncidents();
}

export async function deleteIncident(id) {
  if (!id) return false;
  const { rowCount } = await query(
    `DELETE FROM platform_status_incidents WHERE id = $1`,
    [id]
  );
  return rowCount > 0;
}

export function publicIncident(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    severity: row.severity,
    components: Array.isArray(row.components) ? row.components : [],
    startedAt: row.started_at,
    resolvedAt: row.resolved_at,
    isActive: !row.resolved_at,
    updatedAt: row.updated_at,
  };
}
