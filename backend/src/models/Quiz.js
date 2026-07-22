import { query, pool } from '../config/database.js';

// Quizzes are global to a workspace and linked to campaigns many-to-many. Their
// entries are ingested read-only from a Formidable CSV export (see
// services/quizImport.js for the row shaping). See migration 079.

// ── Quizzes ────────────────────────────────────────────────────────────────

export async function listQuizzesForCampaign(platformOrgId, campaignId) {
  const { rows } = await query(
    `SELECT q.*, COUNT(e.entry_id)::int AS entry_count
       FROM campaign_quizzes cq
       JOIN quizzes q ON q.quiz_id = cq.quiz_id AND q.platform_org_id = $1
       LEFT JOIN quiz_entries e ON e.quiz_id = q.quiz_id
      WHERE cq.campaign_id = $2
      GROUP BY q.quiz_id
      ORDER BY LOWER(q.name) ASC`,
    [platformOrgId, campaignId],
  );
  return rows;
}

export async function listAllQuizzes(platformOrgId) {
  const { rows } = await query(
    `SELECT q.*, COUNT(e.entry_id)::int AS entry_count
       FROM quizzes q
       LEFT JOIN quiz_entries e ON e.quiz_id = q.quiz_id
      WHERE q.platform_org_id = $1
      GROUP BY q.quiz_id
      ORDER BY LOWER(q.name) ASC`,
    [platformOrgId],
  );
  return rows;
}

export async function getQuiz(platformOrgId, quizId) {
  const { rows } = await query(
    `SELECT * FROM quizzes WHERE quiz_id = $1 AND platform_org_id = $2`,
    [quizId, platformOrgId],
  );
  return rows[0] || null;
}

export async function createQuiz(platformOrgId, data, userId) {
  const { rows } = await query(
    `INSERT INTO quizzes (name, description, platform_org_id, created_by)
     VALUES ($1,$2,$3,$4) RETURNING *`,
    [String(data.name || '').trim(), data.description ? String(data.description).trim() : null, platformOrgId, userId],
  );
  return rows[0];
}

export async function updateQuiz(platformOrgId, quizId, data) {
  const sets = [];
  const values = [];
  let i = 1;
  if ('name' in data) { sets.push(`name = $${i++}`); values.push(String(data.name || '').trim()); }
  if ('description' in data) { sets.push(`description = $${i++}`); values.push(data.description ? String(data.description).trim() : null); }
  if (sets.length === 0) return getQuiz(platformOrgId, quizId);
  sets.push('updated_at = NOW()');
  values.push(quizId, platformOrgId);
  const { rows } = await query(
    `UPDATE quizzes SET ${sets.join(', ')} WHERE quiz_id = $${i++} AND platform_org_id = $${i++} RETURNING *`,
    values,
  );
  return rows[0] || null;
}

export async function deleteQuiz(platformOrgId, quizId) {
  await query(`DELETE FROM quizzes WHERE quiz_id = $1 AND platform_org_id = $2`, [quizId, platformOrgId]);
}

// ── Campaign links ─────────────────────────────────────────────────────────

export async function linkQuizToCampaign(campaignId, quizId) {
  await query(
    `INSERT INTO campaign_quizzes (campaign_id, quiz_id) VALUES ($1,$2)
     ON CONFLICT (campaign_id, quiz_id) DO NOTHING`,
    [campaignId, quizId],
  );
}

export async function unlinkQuizFromCampaign(campaignId, quizId) {
  await query(`DELETE FROM campaign_quizzes WHERE campaign_id = $1 AND quiz_id = $2`, [campaignId, quizId]);
}

// ── Entries ────────────────────────────────────────────────────────────────

export async function listEntries(quizId) {
  const { rows } = await query(
    `SELECT e.*, c.contact_firstname AS matched_firstname, c.contact_lastname AS matched_lastname
       FROM quiz_entries e
       LEFT JOIN crm_contacts c ON c.contact_id = e.matched_contact_id
      WHERE e.quiz_id = $1
      ORDER BY e.submitted_at DESC NULLS LAST, e.entry_id DESC`,
    [quizId],
  );
  return rows;
}

// Best-effort contact match maps for a workspace: email (lower-cased) and a
// unique full-name key.
async function loadContactMatchIndex(platformOrgId) {
  const { rows } = await query(
    `SELECT contact_id,
            LOWER(NULLIF(TRIM(contact_email), '')) AS email,
            UPPER(NULLIF(TRIM(CONCAT_WS(' ', contact_firstname, contact_lastname)), '')) AS namekey
       FROM crm_contacts WHERE platform_org_id = $1`,
    [platformOrgId],
  );
  const byEmail = new Map();
  const byName = new Map();
  for (const r of rows) {
    if (r.email && !byEmail.has(r.email)) byEmail.set(r.email, r.contact_id);
    if (r.namekey) {
      if (!byName.has(r.namekey)) byName.set(r.namekey, []);
      byName.get(r.namekey).push(r.contact_id);
    }
  }
  return { byEmail, byName };
}

function matchContactId(index, email, name) {
  const e = String(email || '').trim().toLowerCase();
  if (e && index.byEmail.has(e)) return index.byEmail.get(e);
  const n = String(name || '').trim().toUpperCase().replace(/\s+/g, ' ');
  if (n && index.byName.has(n)) {
    const ids = index.byName.get(n);
    if (ids.length === 1) return ids[0];
  }
  return null;
}

// Upsert entries for a quiz (reconciled by external_id). Returns a summary.
export async function ingestEntries(platformOrgId, quizId, entries, parseSubmittedAt) {
  const index = await loadContactMatchIndex(platformOrgId);
  let imported = 0;
  let matched = 0;
  let skipped = 0;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const e of Array.isArray(entries) ? entries : []) {
      const externalId = String(e.external_id ?? '').trim();
      if (!externalId) { skipped += 1; continue; }
      const contactId = matchContactId(index, e.email, e.name);
      if (contactId) matched += 1;
      await client.query(
        `INSERT INTO quiz_entries
           (quiz_id, external_id, name, email, persona, change_state, change_risk, submitted_at,
            utm_source, utm_campaign, utm_medium, utm_content, raw, matched_contact_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14)
         ON CONFLICT (quiz_id, external_id) DO UPDATE SET
           name = EXCLUDED.name, email = EXCLUDED.email, persona = EXCLUDED.persona,
           change_state = EXCLUDED.change_state, change_risk = EXCLUDED.change_risk,
           submitted_at = EXCLUDED.submitted_at,
           utm_source = EXCLUDED.utm_source, utm_campaign = EXCLUDED.utm_campaign,
           utm_medium = EXCLUDED.utm_medium, utm_content = EXCLUDED.utm_content,
           raw = EXCLUDED.raw, matched_contact_id = EXCLUDED.matched_contact_id,
           updated_at = NOW()`,
        [
          quizId, externalId,
          str(e.name), str(e.email), str(e.persona), str(e.change_state), str(e.change_risk),
          parseSubmittedAt(e.submitted_at),
          str(e.utm_source), str(e.utm_campaign), str(e.utm_medium), str(e.utm_content),
          JSON.stringify(e.raw && typeof e.raw === 'object' ? e.raw : {}),
          contactId,
        ],
      );
      imported += 1;
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return { imported, matched, skipped };
}

function str(v) {
  const s = v == null ? '' : String(v).trim();
  return s === '' ? null : s;
}
