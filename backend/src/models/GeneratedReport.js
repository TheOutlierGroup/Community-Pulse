import { query } from '../config/database.js';

export async function createGeneratedReport({
  organizationId,
  generatedBy,
  stage,
  dateFrom = null,
  dateTo = null,
  format,
  filePath,
  expiresAt,
  status = 'pending',
  failureReason = null,
  meta = {},
}) {
  const { rows } = await query(
    `INSERT INTO generated_reports
      (organization_id, generated_by, stage, date_from, date_to, format, file_path, expires_at, status, failure_reason, meta)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
     RETURNING *`,
    [
      organizationId,
      generatedBy,
      stage,
      dateFrom,
      dateTo,
      format,
      filePath,
      expiresAt,
      status,
      failureReason,
      JSON.stringify(meta || {}),
    ]
  );
  return rows[0] || null;
}

export async function getGeneratedReportById(id) {
  const { rows } = await query(`SELECT * FROM generated_reports WHERE id = $1`, [id]);
  return rows[0] || null;
}

export async function listGeneratedReportsForOrganization(organizationId, { limit = 25 } = {}) {
  const safeLimit = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 200) : 25;
  const { rows } = await query(
    `SELECT gr.id,
            gr.organization_id,
            gr.generated_by,
            gr.stage,
            gr.date_from,
            gr.date_to,
            gr.format,
            gr.expires_at,
            gr.generated_at,
            gr.status,
            gr.failure_reason,
            gr.meta,
            u.email AS generated_by_email,
            u.first_name AS generated_by_first_name,
            u.last_name AS generated_by_last_name
     FROM generated_reports gr
     LEFT JOIN users u ON u.id = gr.generated_by
     WHERE gr.organization_id = $1
     ORDER BY gr.generated_at DESC
     LIMIT $2`,
    [organizationId, safeLimit]
  );
  return rows;
}

export async function markGeneratedReportComplete(id, { filePath, format, expiresAt, meta = {} }) {
  const { rows } = await query(
    `UPDATE generated_reports
     SET status = 'complete',
         format = $2,
         file_path = $3,
         expires_at = $4,
         failure_reason = NULL,
         meta = COALESCE(meta, '{}'::jsonb) || $5::jsonb,
         generated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [id, format, filePath, expiresAt, JSON.stringify(meta || {})]
  );
  return rows[0] || null;
}

export async function markGeneratedReportFailed(id, failureReason, meta = {}) {
  const { rows } = await query(
    `UPDATE generated_reports
     SET status = 'failed',
         failure_reason = $2,
         meta = COALESCE(meta, '{}'::jsonb) || $3::jsonb
     WHERE id = $1
     RETURNING *`,
    [id, String(failureReason || 'Generation failed').slice(0, 2000), JSON.stringify(meta || {})]
  );
  return rows[0] || null;
}
