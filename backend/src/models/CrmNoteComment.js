import { query } from '../config/database.js';

/** Batch form for a notes list — returns a Map<noteId, comment[]>. */
export async function listCommentsForNoteIds(noteIds) {
  const ids = (noteIds || []).map((id) => Number(id)).filter((id) => Number.isInteger(id));
  const map = new Map();
  if (!ids.length) return map;
  const { rows } = await query(
    `SELECT c.*, u.first_name || ' ' || COALESCE(u.last_name, '') AS author_name
       FROM crm_note_comments c
       LEFT JOIN users u ON u.id = c.created_by
      WHERE c.note_id = ANY($1::int[])
      ORDER BY c.created_at ASC`,
    [ids]
  );
  for (const row of rows) {
    const key = row.note_id;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }
  return map;
}

/**
 * @param organisationId - the note's owning CRM org, for tenant scoping;
 *   pass null when the note is contact-scoped (contactId is enough there
 *   since crm_contacts is already org-scoped one level up).
 */
export async function createComment(noteId, { organisationId, contactId } = {}, commentText, createdBy) {
  const scoped = organisationId
    ? await query(`SELECT 1 FROM crm_notes WHERE note_id = $1 AND organisation_id = $2`, [noteId, organisationId])
    : await query(`SELECT 1 FROM crm_notes WHERE note_id = $1 AND contact_id = $2`, [noteId, contactId]);
  if (!scoped.rows.length) return null;
  const { rows } = await query(
    `INSERT INTO crm_note_comments (note_id, comment_text, created_by)
     VALUES ($1, $2, $3) RETURNING comment_id`,
    [noteId, commentText, createdBy || null]
  );
  const { rows: withAuthor } = await query(
    `SELECT c.*, u.first_name || ' ' || COALESCE(u.last_name, '') AS author_name
       FROM crm_note_comments c
       LEFT JOIN users u ON u.id = c.created_by
      WHERE c.comment_id = $1`,
    [rows[0].comment_id]
  );
  return withAuthor[0];
}

export async function deleteComment(commentId, { organisationId, contactId } = {}) {
  if (organisationId) {
    const { rowCount } = await query(
      `DELETE FROM crm_note_comments c
        USING crm_notes n
       WHERE c.comment_id = $1 AND c.note_id = n.note_id AND n.organisation_id = $2`,
      [commentId, organisationId]
    );
    return rowCount > 0;
  }
  if (contactId) {
    const { rowCount } = await query(
      `DELETE FROM crm_note_comments c
        USING crm_notes n
       WHERE c.comment_id = $1 AND c.note_id = n.note_id AND n.contact_id = $2`,
      [commentId, contactId]
    );
    return rowCount > 0;
  }
  return false;
}
