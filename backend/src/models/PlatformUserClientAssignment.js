import { pool, query } from '../config/database.js';

export async function userHasClientOrgAssignment(platformUserId, clientOrgId) {
  const { rows } = await query(
    `SELECT 1
     FROM platform_user_client_assignments
     WHERE platform_user_id = $1 AND client_org_id = $2`,
    [platformUserId, clientOrgId]
  );
  return rows.length > 0;
}

export async function listAssignedClientOrgIdsForUser(platformUserId) {
  const { rows } = await query(
    `SELECT client_org_id
     FROM platform_user_client_assignments
     WHERE platform_user_id = $1
     ORDER BY created_at ASC`,
    [platformUserId]
  );
  return rows.map((r) => r.client_org_id);
}

export async function replaceAssignmentsForUser(platformUserId, clientOrgIds) {
  const uniqueIds = [...new Set((clientOrgIds || []).map((id) => String(id).trim()).filter(Boolean))];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `DELETE FROM platform_user_client_assignments
       WHERE platform_user_id = $1`,
      [platformUserId]
    );
    for (const clientOrgId of uniqueIds) {
      await client.query(
        `INSERT INTO platform_user_client_assignments (platform_user_id, client_org_id)
         VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [platformUserId, clientOrgId]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return uniqueIds;
}

export async function listAssignmentCountsForUsers(platformUserIds) {
  const uniqueIds = [...new Set((platformUserIds || []).map((id) => String(id).trim()).filter(Boolean))];
  if (!uniqueIds.length) return new Map();
  const { rows } = await query(
    `SELECT platform_user_id, COUNT(*)::int AS assignment_count
     FROM platform_user_client_assignments
     WHERE platform_user_id = ANY($1::uuid[])
     GROUP BY platform_user_id`,
    [uniqueIds]
  );
  const out = new Map();
  for (const row of rows) {
    out.set(String(row.platform_user_id), Number(row.assignment_count) || 0);
  }
  return out;
}
