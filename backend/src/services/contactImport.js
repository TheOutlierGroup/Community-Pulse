import { pool } from '../config/database.js';
import { planContactImport, IMPORT_SOURCES } from './contactImportPlan.js';

// Cap per request. The initial one-off LinkedIn export is large (~13k); regular
// exports are small. Splitting a huge file keeps the request inside sane time
// and memory bounds — the client is told to split when over the cap.
export const MAX_IMPORT_ROWS = 5000;

const CORE_FIELDS = ['contact_firstname', 'contact_lastname', 'contact_email', 'contact_phone', 'contact_role'];

export async function importContacts(platformOrgId, source, rows, userId) {
  if (!IMPORT_SOURCES.has(source)) {
    const err = new Error('Unknown import source.');
    err.status = 400;
    throw err;
  }
  if (!Array.isArray(rows)) {
    const err = new Error('No rows to import.');
    err.status = 400;
    throw err;
  }
  if (rows.length > MAX_IMPORT_ROWS) {
    const err = new Error(`Too many rows (${rows.length}). Split the file into batches of ${MAX_IMPORT_ROWS} or fewer.`);
    err.status = 400;
    throw err;
  }

  const { rows: existing } = await pool.query(
    `SELECT contact_id, contact_firstname, contact_lastname, contact_email, contact_phone,
            contact_role, linkedin_url, protected_fields, enrichment, enrichment_sources
       FROM crm_contacts WHERE platform_org_id = $1`,
    [platformOrgId],
  );

  const { creates, updates, summary } = planContactImport(existing, source, rows);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const c of creates) {
      await client.query(
        `INSERT INTO crm_contacts
           (contact_firstname, contact_lastname, contact_email, contact_phone, contact_role,
            relationship_status, linkedin_url, source, enrichment, enrichment_sources,
            platform_org_id, created_by, last_enriched_at)
         VALUES ($1,$2,$3,$4,$5,'new',$6,$7,$8::jsonb,$9,$10,$11, NOW())`,
        [
          c.core.contact_firstname || null,
          c.core.contact_lastname || null,
          c.core.contact_email || null,
          c.core.contact_phone || null,
          c.core.contact_role || null,
          c.linkedin_url,
          c.source,
          JSON.stringify(c.enrichment || {}),
          [c.source],
          platformOrgId,
          userId,
        ],
      );
    }

    for (const u of updates) {
      const sets = [];
      const values = [];
      let i = 1;
      for (const field of CORE_FIELDS) {
        if (field in u.core) { sets.push(`${field} = $${i++}`); values.push(u.core[field]); }
      }
      if (u.linkedin_url) { sets.push(`linkedin_url = $${i++}`); values.push(u.linkedin_url); }

      const hasEnrichment = u.enrichment && Object.keys(u.enrichment).length > 0;
      if (hasEnrichment) {
        // Replace this source's namespaced blob wholesale (a re-import refreshes it).
        sets.push(`enrichment = jsonb_set(COALESCE(enrichment, '{}'::jsonb), ARRAY[$${i++}], $${i++}::jsonb, true)`);
        values.push(u.source);
        values.push(JSON.stringify(u.enrichment));
      }
      // Record the source in enrichment_sources if not already present.
      sets.push(`enrichment_sources = CASE WHEN $${i} = ANY(enrichment_sources) THEN enrichment_sources ELSE array_append(enrichment_sources, $${i}) END`);
      values.push(u.source);
      i += 1;

      sets.push('last_enriched_at = NOW()');
      sets.push('updated_at = NOW()');

      values.push(u.contact_id, platformOrgId);
      await client.query(
        `UPDATE crm_contacts SET ${sets.join(', ')} WHERE contact_id = $${i++} AND platform_org_id = $${i++}`,
        values,
      );
    }

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  return summary;
}
