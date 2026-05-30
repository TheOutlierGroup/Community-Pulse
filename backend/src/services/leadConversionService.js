import { pool } from '../config/database.js';
import * as Lead from '../models/Lead.js';
import * as Project from '../models/Project.js';

/**
 * Converts a won lead into a Project in a single database transaction.
 *
 * What happens inside the transaction:
 *  1. Re-read the lead with a SELECT FOR UPDATE lock to prevent races.
 *  2. Refuse if lead is already locked/won or lost.
 *  3. Set won_at + locked_at on the lead (immutable from this point).
 *  4. Sum the lead's estimate line items → baseline figures.
 *  5. Create a new Project row with those baseline figures.
 *  6. Write a lead_activity "converted_to_project" entry.
 *  7. Seed an initial project_activity "converted_from_lead" entry.
 *
 * Returns { lead, project } on success.
 * Returns { error: string } on a soft failure (already won, already lost, etc.)
 */
export async function convertLeadToProject(leadId, actorId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Lock the lead row for the duration of this transaction
    const { rows: leadRows } = await client.query(
      `SELECT * FROM leads WHERE id = $1 FOR UPDATE`,
      [leadId]
    );
    const lead = leadRows[0];
    if (!lead) { await client.query('ROLLBACK'); return { error: 'Lead not found' }; }
    if (lead.locked_at) { await client.query('ROLLBACK'); return { error: 'Lead is already locked (Mark as Won has already been applied)' }; }
    if (lead.lost_at) { await client.query('ROLLBACK'); return { error: 'Lead is marked as Lost and cannot be converted' }; }

    // Lock + win the lead
    const now = new Date();
    await client.query(
      `UPDATE leads SET won_at = $2, locked_at = $2, updated_at = $2 WHERE id = $1`,
      [leadId, now]
    );

    // Sum estimates into baseline figures
    const { rows: estRows } = await client.query(
      `SELECT
         COALESCE(SUM(hours * quantity), 0)::numeric      AS total_hours,
         COALESCE(SUM(unit_cost * quantity), 0)::numeric  AS total_cost
       FROM lead_estimates WHERE lead_id = $1`,
      [leadId]
    );
    const baselineHours = Number(estRows[0]?.total_hours || 0);
    const baselineCost = Number(estRows[0]?.total_cost || 0);

    // Derive a project name from the lead title
    const projectName = lead.title;

    // Create the project
    const { rows: projRows } = await client.query(
      `INSERT INTO projects
         (organization_id, business_unit_id, lead_id, account_id, contact_id,
          name, description, baseline_hours, baseline_cost, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'planning',$10)
       RETURNING *`,
      [
        lead.organization_id,
        lead.business_unit_id,
        lead.id,
        lead.account_id,
        lead.contact_id,
        projectName,
        lead.description || null,
        baselineHours,
        baselineCost,
        actorId || null,
      ]
    );
    const project = projRows[0];

    // Append activity log on the lead
    await client.query(
      `INSERT INTO lead_activity (lead_id, actor_id, event_type, payload)
       VALUES ($1, $2, 'converted_to_project', $3::jsonb)`,
      [leadId, actorId || null, JSON.stringify({ projectId: project.id, projectName })]
    );

    // Seed the project activity with the conversion event
    await client.query(
      `INSERT INTO project_activity (project_id, actor_id, event_type, payload)
       VALUES ($1, $2, 'converted_from_lead', $3::jsonb)`,
      [
        project.id, actorId || null,
        JSON.stringify({
          leadId: lead.id,
          leadTitle: lead.title,
          baselineHours,
          baselineCost,
        }),
      ]
    );

    await client.query('COMMIT');

    // Re-read with joined fields for the response
    const fullProject = await Project.getProject(project.id);
    const { rows: updatedLead } = await client.query(
      `SELECT * FROM leads WHERE id = $1`,
      [leadId]
    ).catch(() => ({ rows: [lead] }));

    return { lead: updatedLead[0] || lead, project: fullProject };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
