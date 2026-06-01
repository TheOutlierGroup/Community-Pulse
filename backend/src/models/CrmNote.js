import { query } from '../config/database.js';

export async function listNotesForOrg(organisationId) {
  const { rows } = await query(
    `SELECT n.*, u.name AS author_name
       FROM crm_notes n
       LEFT JOIN users u ON u.id = n.created_by
      WHERE n.organisation_id = $1
      ORDER BY n.created_at DESC`,
    [organisationId],
  );
  return rows;
}

export async function listNotesForContact(contactId) {
  const { rows } = await query(
    `SELECT n.*, u.name AS author_name
       FROM crm_notes n
       LEFT JOIN users u ON u.id = n.created_by
      WHERE n.contact_id = $1
      ORDER BY n.created_at DESC`,
    [contactId],
  );
  return rows;
}

export async function createNoteForOrg(organisationId, noteText, createdBy) {
  const { rows } = await query(
    `INSERT INTO crm_notes (note_text, organisation_id, created_by)
     VALUES ($1,$2,$3) RETURNING *`,
    [noteText, organisationId, createdBy || null],
  );
  await query(`UPDATE crm_organisations SET updated_at = NOW() WHERE organisation_id = $1`, [organisationId]);
  return rows[0];
}

export async function createNoteForContact(contactId, organisationId, noteText, createdBy) {
  const { rows } = await query(
    `INSERT INTO crm_notes (note_text, contact_id, created_by)
     VALUES ($1,$2,$3) RETURNING *`,
    [noteText, contactId, createdBy || null],
  );
  await query(`UPDATE crm_organisations SET updated_at = NOW() WHERE organisation_id = $1`, [organisationId]);
  return rows[0];
}

export async function deleteNote(noteId, { organisationId, contactId } = {}) {
  // Verify ownership before deleting
  if (organisationId) {
    await query(`DELETE FROM crm_notes WHERE note_id = $1 AND organisation_id = $2`, [noteId, organisationId]);
  } else if (contactId) {
    await query(`DELETE FROM crm_notes WHERE note_id = $1 AND contact_id = $2`, [noteId, contactId]);
  }
}
