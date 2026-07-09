import { query } from '../config/database.js';

export const MILESTONE_STATUSES = ['planned', 'in_progress', 'complete'];

export async function getOrCreateProjectForOrg(organizationId) {
  const { rows } = await query(
    `SELECT * FROM client_projects WHERE organization_id = $1`,
    [organizationId],
  );
  if (rows[0]) return rows[0];
  const inserted = await query(
    `INSERT INTO client_projects (organization_id) VALUES ($1)
     ON CONFLICT (organization_id) DO UPDATE SET organization_id = EXCLUDED.organization_id
     RETURNING *`,
    [organizationId],
  );
  return inserted.rows[0];
}

export async function getProjectForOrg(organizationId) {
  const { rows } = await query(
    `SELECT * FROM client_projects WHERE organization_id = $1`,
    [organizationId],
  );
  return rows[0] || null;
}

export async function updateProject(projectId, { summary, progressPct }) {
  const sets = [];
  const values = [];
  let i = 1;
  if (summary !== undefined) {
    sets.push(`summary = $${i++}`);
    values.push(summary || null);
  }
  if (progressPct !== undefined) {
    const pct = Math.max(0, Math.min(100, Number.parseInt(progressPct, 10) || 0));
    sets.push(`progress_pct = $${i++}`);
    values.push(pct);
  }
  if (sets.length === 0) {
    const { rows } = await query(`SELECT * FROM client_projects WHERE id = $${i}`, [projectId]);
    return rows[0] || null;
  }
  sets.push('updated_at = NOW()');
  values.push(projectId);
  const { rows } = await query(
    `UPDATE client_projects SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
    values,
  );
  return rows[0] || null;
}

export async function listMilestones(projectId) {
  const { rows } = await query(
    `SELECT * FROM client_project_milestones WHERE project_id = $1 ORDER BY position ASC, created_at ASC`,
    [projectId],
  );
  return rows;
}

export async function createMilestone(projectId, { title, targetDate, status, notes }) {
  const { rows: posRows } = await query(
    `SELECT COALESCE(MAX(position), -1) + 1 AS next_position FROM client_project_milestones WHERE project_id = $1`,
    [projectId],
  );
  const { rows } = await query(
    `INSERT INTO client_project_milestones (project_id, title, target_date, status, notes, position)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING *`,
    [
      projectId,
      title,
      targetDate || null,
      MILESTONE_STATUSES.includes(status) ? status : 'planned',
      notes || null,
      posRows[0].next_position,
    ],
  );
  return rows[0];
}

export async function updateMilestone(projectId, milestoneId, { title, targetDate, status, notes }) {
  const sets = [];
  const values = [];
  let i = 1;
  if (title !== undefined) { sets.push(`title = $${i++}`); values.push(title); }
  if (targetDate !== undefined) { sets.push(`target_date = $${i++}`); values.push(targetDate || null); }
  if (status !== undefined) { sets.push(`status = $${i++}`); values.push(MILESTONE_STATUSES.includes(status) ? status : 'planned'); }
  if (notes !== undefined) { sets.push(`notes = $${i++}`); values.push(notes || null); }
  if (sets.length === 0) {
    const { rows } = await query(
      `SELECT * FROM client_project_milestones WHERE id = $1 AND project_id = $2`,
      [milestoneId, projectId],
    );
    return rows[0] || null;
  }
  sets.push('updated_at = NOW()');
  values.push(milestoneId, projectId);
  const { rows } = await query(
    `UPDATE client_project_milestones SET ${sets.join(', ')} WHERE id = $${i++} AND project_id = $${i++} RETURNING *`,
    values,
  );
  return rows[0] || null;
}

export async function deleteMilestone(projectId, milestoneId) {
  await query(
    `DELETE FROM client_project_milestones WHERE id = $1 AND project_id = $2`,
    [milestoneId, projectId],
  );
}

export async function milestoneBelongsToProject(projectId, milestoneId) {
  const { rows } = await query(
    `SELECT 1 FROM client_project_milestones WHERE id = $1 AND project_id = $2`,
    [milestoneId, projectId],
  );
  return rows.length > 0;
}

export async function listFiles(projectId) {
  const { rows } = await query(
    `SELECT f.*, u.first_name, u.last_name, u.email
       FROM client_project_files f
       LEFT JOIN users u ON u.id = f.uploaded_by
      WHERE f.project_id = $1
      ORDER BY f.created_at DESC`,
    [projectId],
  );
  return rows;
}

export async function createFileRecord(projectId, { filename, originalName, sizeBytes, contentType, uploadedBy }) {
  const { rows } = await query(
    `INSERT INTO client_project_files (project_id, filename, original_name, size_bytes, content_type, uploaded_by)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING *`,
    [projectId, filename, originalName, sizeBytes || 0, contentType || null, uploadedBy || null],
  );
  return rows[0];
}

export async function getFile(projectId, fileId) {
  const { rows } = await query(
    `SELECT * FROM client_project_files WHERE id = $1 AND project_id = $2`,
    [fileId, projectId],
  );
  return rows[0] || null;
}

export async function deleteFileRecord(projectId, fileId) {
  await query(
    `DELETE FROM client_project_files WHERE id = $1 AND project_id = $2`,
    [fileId, projectId],
  );
}
