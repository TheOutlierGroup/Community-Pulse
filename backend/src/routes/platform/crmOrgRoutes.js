import { Router } from 'express';
import fs from 'fs';
import {
  listOrganisations, getOrganisation, createOrganisation,
  updateOrganisation, deleteOrganisation, organisationBelongsToOrg,
  setLogoFilename, clearLogoFilename, markPromoted,
  BUSINESS_UNITS, LEAD_STATUSES,
} from '../../models/CrmOrganisation.js';
import { listContacts, createContact, updateContact, deleteContact, contactBelongsToOrg } from '../../models/CrmContact.js';
import {
  listNotesForOrg, listNotesForContact,
  createNoteForOrg, createNoteForContact, deleteNote,
} from '../../models/CrmNote.js';
import { auditFromRequest, AUDIT_ACTIONS, listRecentAuditEvents, publicAuditEvent } from '../../services/auditLog.js';
import {
  listTasksForOrg, getTaskForOrg, createTask, updateTask, deleteTask, reorderTasks,
} from '../../models/CrmOrganisationTask.js';
import { listUsersForOrg } from '../../models/User.js';
import { extensionForUpload } from '../../middleware/avatarUpload.js';
import { orgLogoFilePath } from '../../config/storage.js';
import { brandUploadLimiter } from '../../middleware/sensitiveRateLimit.js';
import { handleOrgLogoPlatformUpload, sendOrgLogoFileOr404, assertClientOrganizationPlatformForUser } from './shared.js';
import * as Organization from '../../models/Organization.js';

const router = Router();

function orgId(req) { return req.user.organizationId; }

function noteExcerpt(text) {
  const trimmed = String(text || '').trim();
  return trimmed.length > 80 ? `${trimmed.slice(0, 80)}…` : trimmed;
}

function publicTask(row) {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    position: row.position,
    dueDate: row.due_date,
    assignedTo: row.assigned_to,
    assignee: row.assigned_to
      ? {
          id: row.assigned_to,
          email: row.assignee_email,
          firstName: row.assignee_first_name,
          lastName: row.assignee_last_name,
        }
      : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ── Organisations ──────────────────────────────────────────────────────────

router.get('/organisations', async (req, res) => {
  try {
    const { search, businessUnit, leadStatus, limit, offset } = req.query;
    const orgs = await listOrganisations(orgId(req), { search, businessUnit, leadStatus, limit, offset });
    res.json({ organisations: orgs });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to list organisations.' });
  }
});

router.post('/organisations', async (req, res) => {
  try {
    if (!req.body.organisation_name?.trim()) return res.status(400).json({ error: 'organisation_name is required.' });
    const org = await createOrganisation(orgId(req), req.body);
    auditFromRequest(req)({
      action: AUDIT_ACTIONS.CRM_ORGANISATION_CREATE,
      targetType: 'crm_organisation',
      targetId: String(org.organisation_id),
      targetOrganizationId: orgId(req),
      metadata: { name: org.organisation_name, businessUnit: org.business_unit },
    });
    res.status(201).json({ organisation: org });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to create organisation.' });
  }
});

router.get('/organisations/:id', async (req, res) => {
  try {
    const org = await getOrganisation(orgId(req), req.params.id);
    if (!org) return res.status(404).json({ error: 'Organisation not found.' });
    const [contacts, notes] = await Promise.all([
      listContacts(org.organisation_id),
      listNotesForOrg(org.organisation_id),
    ]);
    res.json({ organisation: org, contacts, notes });
  } catch (e) {
    console.error('[CRM] GET organisation error:', e.message);
    res.status(500).json({ error: e.message || 'Failed to load organisation.' });
  }
});

router.patch('/organisations/:id', async (req, res) => {
  try {
    const org = await updateOrganisation(orgId(req), req.params.id, req.body);
    if (!org) return res.status(404).json({ error: 'Organisation not found.' });
    auditFromRequest(req)({
      action: AUDIT_ACTIONS.CRM_ORGANISATION_UPDATE,
      targetType: 'crm_organisation',
      targetId: String(org.organisation_id),
      targetOrganizationId: orgId(req),
      metadata: { patchedFields: Object.keys(req.body || {}) },
    });
    res.json({ organisation: org });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to update organisation.' });
  }
});

router.delete('/organisations/:id', async (req, res) => {
  try {
    const org = await getOrganisation(orgId(req), req.params.id);
    if (!org) return res.status(404).json({ error: 'Organisation not found.' });
    await deleteOrganisation(orgId(req), req.params.id);
    auditFromRequest(req)({
      action: AUDIT_ACTIONS.CRM_ORGANISATION_DELETE,
      targetType: 'crm_organisation',
      targetId: String(org.organisation_id),
      targetOrganizationId: orgId(req),
      metadata: { name: org.organisation_name },
    });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to delete organisation.' });
  }
});

// ── Promotion ────────────────────────────────────────────────────────────────

router.post('/organisations/:id/promote', async (req, res) => {
  try {
    const prospect = await getOrganisation(orgId(req), req.params.id);
    if (!prospect) return res.status(404).json({ error: 'Organisation not found.' });
    if (prospect.promoted_to_org_id) {
      return res.status(409).json({ error: 'This prospect has already been promoted.' });
    }
    const clientOrgId = req.body?.clientOrgId;
    if (!clientOrgId) return res.status(400).json({ error: 'clientOrgId is required.' });
    const clientOrg = await assertClientOrganizationPlatformForUser(clientOrgId, req.user);
    if (!clientOrg) return res.status(404).json({ error: 'Client not found.' });

    // Carry the prospect's logo over if the new client doesn't already have one.
    if (prospect.logo_filename && !clientOrg.company_logo_filename) {
      try {
        const ext = String(prospect.logo_filename).match(/\.[a-z0-9]+$/i)?.[0] || '.png';
        const base = `org-${clientOrg.id}${ext}`;
        const bytes = await fs.promises.readFile(orgLogoFilePath(prospect.logo_filename));
        await fs.promises.writeFile(orgLogoFilePath(base), bytes);
        await Organization.setCompanyLogoFilename(clientOrg.id, base);
      } catch (e) {
        console.error('Failed to carry prospect logo to new client:', e);
      }
    }

    auditFromRequest(req)({
      action: AUDIT_ACTIONS.ORG_PROMOTED_FROM_PROSPECT,
      targetType: 'organization',
      targetId: clientOrg.id,
      targetOrganizationId: clientOrg.id,
      // Backdated to just before the client's own creation event so this
      // carryover record always sinks to the bottom of the client's Recent
      // Activity feed, instead of floating to the top as the newest entry.
      occurredAt: new Date(new Date(clientOrg.created_at).getTime() - 1000),
      metadata: {
        prospectId: prospect.organisation_id,
        prospectName: prospect.organisation_name,
        leadStatus: prospect.lead_status,
        website: prospect.website,
        phone: prospect.phone,
        leadSource: prospect.lead_source,
        prospectCreatedDate: prospect.created_date,
        expectedCloseDate: prospect.expected_close_date,
      },
    });

    const updated = await markPromoted(orgId(req), req.params.id, clientOrg.id);
    auditFromRequest(req)({
      action: AUDIT_ACTIONS.CRM_ORGANISATION_PROMOTE,
      targetType: 'crm_organisation',
      targetId: String(prospect.organisation_id),
      targetOrganizationId: orgId(req),
      metadata: { name: prospect.organisation_name, clientOrgId: clientOrg.id },
    });

    res.json({ organisation: updated });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to promote prospect.' });
  }
});

// ── Logo ────────────────────────────────────────────────────────────────────

router.get('/organisations/:id/logo', async (req, res) => {
  try {
    const org = await getOrganisation(orgId(req), req.params.id);
    if (!org || !org.logo_filename) return res.status(404).end();
    sendOrgLogoFileOr404(res, org.logo_filename);
  } catch (e) {
    console.error(e);
    res.status(500).end();
  }
});

router.post('/organisations/:id/logo', brandUploadLimiter, handleOrgLogoPlatformUpload, async (req, res) => {
  try {
    const org = await getOrganisation(orgId(req), req.params.id);
    if (!org) return res.status(404).json({ error: 'Organisation not found.' });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const ext = extensionForUpload(req.file);
    const base = `crm-org-${org.organisation_id}${ext || '.png'}`;
    if (org.logo_filename && org.logo_filename !== base) {
      try {
        await fs.promises.unlink(orgLogoFilePath(org.logo_filename));
      } catch {
        /* ignore */
      }
    }
    await fs.promises.writeFile(orgLogoFilePath(base), req.file.buffer);
    const updated = await setLogoFilename(orgId(req), req.params.id, base);
    auditFromRequest(req)({
      action: AUDIT_ACTIONS.CRM_ORGANISATION_LOGO_UPLOAD,
      targetType: 'crm_organisation',
      targetId: String(org.organisation_id),
      targetOrganizationId: orgId(req),
      metadata: { name: org.organisation_name },
    });
    res.json({ organisation: updated });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not save logo' });
  }
});

router.delete('/organisations/:id/logo', async (req, res) => {
  try {
    const org = await getOrganisation(orgId(req), req.params.id);
    if (!org) return res.status(404).json({ error: 'Organisation not found.' });
    const prev = await clearLogoFilename(orgId(req), req.params.id);
    if (prev) {
      try {
        await fs.promises.unlink(orgLogoFilePath(prev));
      } catch {
        /* ignore */
      }
    }
    const updated = await getOrganisation(orgId(req), req.params.id);
    auditFromRequest(req)({
      action: AUDIT_ACTIONS.CRM_ORGANISATION_LOGO_DELETE,
      targetType: 'crm_organisation',
      targetId: String(org.organisation_id),
      targetOrganizationId: orgId(req),
      metadata: { name: org.organisation_name },
    });
    res.json({ organisation: updated });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not remove logo' });
  }
});

// ── Recent activity ─────────────────────────────────────────────────────────

router.get('/organisations/:id/audit-events', async (req, res) => {
  try {
    if (!await organisationBelongsToOrg(orgId(req), req.params.id))
      return res.status(404).json({ error: 'Organisation not found.' });
    const limit = Number.parseInt(req.query?.limit, 10) || 50;
    const rows = await listRecentAuditEvents({
      organizationId: orgId(req),
      targetId: req.params.id,
      limit,
    });
    res.json({ events: rows.map(publicAuditEvent) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load recent activity.' });
  }
});

// ── Tasks ────────────────────────────────────────────────────────────────

router.get('/organisations/:id/tasks', async (req, res) => {
  try {
    if (!await organisationBelongsToOrg(orgId(req), req.params.id))
      return res.status(404).json({ error: 'Organisation not found.' });
    const rows = await listTasksForOrg(req.params.id);
    res.json({ tasks: rows.map(publicTask) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load tasks.' });
  }
});

router.get('/organisations/:id/tasks/assignable-users', async (req, res) => {
  try {
    if (!await organisationBelongsToOrg(orgId(req), req.params.id))
      return res.status(404).json({ error: 'Organisation not found.' });
    const rows = await listUsersForOrg(orgId(req));
    res.json({
      users: rows.map((u) => ({
        id: u.id,
        email: u.email,
        firstName: u.first_name,
        lastName: u.last_name,
      })),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load assignable users.' });
  }
});

router.post('/organisations/:id/tasks', async (req, res) => {
  try {
    if (!req.body.title?.trim()) return res.status(400).json({ error: 'title is required.' });
    if (!await organisationBelongsToOrg(orgId(req), req.params.id))
      return res.status(404).json({ error: 'Organisation not found.' });
    const task = await createTask(
      req.params.id,
      {
        title: req.body.title.trim(),
        status: req.body.status,
        assignedTo: req.body.assignedTo || null,
        dueDate: req.body.dueDate || null,
      },
      req.user.id
    );
    auditFromRequest(req)({
      action: AUDIT_ACTIONS.CRM_TASK_CREATE,
      targetType: 'crm_task',
      targetId: req.params.id,
      targetOrganizationId: orgId(req),
      metadata: { title: task.title },
    });
    res.status(201).json({ task: publicTask(task) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to create task.' });
  }
});

router.patch('/organisations/:id/tasks/reorder', async (req, res) => {
  try {
    if (!await organisationBelongsToOrg(orgId(req), req.params.id))
      return res.status(404).json({ error: 'Organisation not found.' });
    const updates = Array.isArray(req.body?.tasks) ? req.body.tasks : null;
    if (!updates) return res.status(400).json({ error: 'tasks must be an array.' });
    const ok = await reorderTasks(req.params.id, updates);
    if (!ok) return res.status(400).json({ error: 'Could not reorder tasks.' });
    const rows = await listTasksForOrg(req.params.id);
    res.json({ tasks: rows.map(publicTask) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to reorder tasks.' });
  }
});

router.patch('/organisations/:id/tasks/:taskId', async (req, res) => {
  try {
    if (!await organisationBelongsToOrg(orgId(req), req.params.id))
      return res.status(404).json({ error: 'Organisation not found.' });
    const patch = {};
    if ('title' in req.body) patch.title = String(req.body.title || '').trim();
    if ('status' in req.body) patch.status = req.body.status;
    if ('assignedTo' in req.body) patch.assignedTo = req.body.assignedTo || null;
    if ('dueDate' in req.body) patch.dueDate = req.body.dueDate || null;
    const task = await updateTask(req.params.taskId, req.params.id, patch);
    if (!task) return res.status(404).json({ error: 'Task not found.' });
    auditFromRequest(req)({
      action: AUDIT_ACTIONS.CRM_TASK_UPDATE,
      targetType: 'crm_task',
      targetId: req.params.id,
      targetOrganizationId: orgId(req),
      metadata: { title: task.title, patchedFields: Object.keys(patch) },
    });
    res.json({ task: publicTask(task) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to update task.' });
  }
});

router.delete('/organisations/:id/tasks/:taskId', async (req, res) => {
  try {
    if (!await organisationBelongsToOrg(orgId(req), req.params.id))
      return res.status(404).json({ error: 'Organisation not found.' });
    const task = await getTaskForOrg(req.params.taskId, req.params.id);
    if (!task) return res.status(404).json({ error: 'Task not found.' });
    await deleteTask(req.params.taskId, req.params.id);
    auditFromRequest(req)({
      action: AUDIT_ACTIONS.CRM_TASK_DELETE,
      targetType: 'crm_task',
      targetId: req.params.id,
      targetOrganizationId: orgId(req),
      metadata: { title: task.title },
    });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to delete task.' });
  }
});

// ── Organisation notes ─────────────────────────────────────────────────────

router.get('/organisations/:id/notes', async (req, res) => {
  try {
    if (!await organisationBelongsToOrg(orgId(req), req.params.id))
      return res.status(404).json({ error: 'Organisation not found.' });
    const notes = await listNotesForOrg(req.params.id);
    res.json({ notes });
  } catch (e) {
    res.status(500).json({ error: 'Failed to load notes.' });
  }
});

router.post('/organisations/:id/notes', async (req, res) => {
  try {
    if (!req.body.note_text?.trim()) return res.status(400).json({ error: 'note_text is required.' });
    if (!await organisationBelongsToOrg(orgId(req), req.params.id))
      return res.status(404).json({ error: 'Organisation not found.' });
    const note = await createNoteForOrg(req.params.id, req.body.note_text, req.user.id);
    auditFromRequest(req)({
      action: AUDIT_ACTIONS.CRM_NOTE_CREATE,
      targetType: 'crm_note',
      targetId: req.params.id,
      targetOrganizationId: orgId(req),
      metadata: { kind: 'organisation note', excerpt: noteExcerpt(req.body.note_text) },
    });
    res.status(201).json({ note });
  } catch (e) {
    res.status(500).json({ error: 'Failed to add note.' });
  }
});

router.delete('/organisations/:id/notes/:noteId', async (req, res) => {
  try {
    if (!await organisationBelongsToOrg(orgId(req), req.params.id))
      return res.status(404).json({ error: 'Organisation not found.' });
    await deleteNote(req.params.noteId, { organisationId: req.params.id });
    auditFromRequest(req)({
      action: AUDIT_ACTIONS.CRM_NOTE_DELETE,
      targetType: 'crm_note',
      targetId: req.params.id,
      targetOrganizationId: orgId(req),
      metadata: { kind: 'organisation note' },
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to delete note.' });
  }
});

// ── Contacts ───────────────────────────────────────────────────────────────

router.post('/organisations/:id/contacts', async (req, res) => {
  try {
    if (!req.body.contact_firstname?.trim()) return res.status(400).json({ error: 'contact_firstname is required.' });
    if (!await organisationBelongsToOrg(orgId(req), req.params.id))
      return res.status(404).json({ error: 'Organisation not found.' });
    const contact = await createContact(req.params.id, req.body);
    auditFromRequest(req)({
      action: AUDIT_ACTIONS.CRM_CONTACT_CREATE,
      targetType: 'crm_contact',
      targetId: req.params.id,
      targetOrganizationId: orgId(req),
      metadata: { name: [contact.contact_firstname, contact.contact_lastname].filter(Boolean).join(' ') },
    });
    res.status(201).json({ contact });
  } catch (e) {
    res.status(500).json({ error: 'Failed to add contact.' });
  }
});

router.patch('/organisations/:id/contacts/:contactId', async (req, res) => {
  try {
    if (!await organisationBelongsToOrg(orgId(req), req.params.id))
      return res.status(404).json({ error: 'Organisation not found.' });
    const contact = await updateContact(req.params.contactId, req.params.id, req.body);
    if (!contact) return res.status(404).json({ error: 'Contact not found.' });
    auditFromRequest(req)({
      action: AUDIT_ACTIONS.CRM_CONTACT_UPDATE,
      targetType: 'crm_contact',
      targetId: req.params.id,
      targetOrganizationId: orgId(req),
      metadata: {
        name: [contact.contact_firstname, contact.contact_lastname].filter(Boolean).join(' '),
        patchedFields: Object.keys(req.body || {}),
      },
    });
    res.json({ contact });
  } catch (e) {
    res.status(500).json({ error: 'Failed to update contact.' });
  }
});

router.delete('/organisations/:id/contacts/:contactId', async (req, res) => {
  try {
    if (!await organisationBelongsToOrg(orgId(req), req.params.id))
      return res.status(404).json({ error: 'Organisation not found.' });
    if (!await contactBelongsToOrg(req.params.id, req.params.contactId))
      return res.status(404).json({ error: 'Contact not found.' });
    await deleteContact(req.params.contactId, req.params.id);
    auditFromRequest(req)({
      action: AUDIT_ACTIONS.CRM_CONTACT_DELETE,
      targetType: 'crm_contact',
      targetId: req.params.id,
      targetOrganizationId: orgId(req),
      metadata: {},
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to delete contact.' });
  }
});

// ── Contact notes ──────────────────────────────────────────────────────────

router.get('/organisations/:id/contacts/:contactId/notes', async (req, res) => {
  try {
    if (!await contactBelongsToOrg(req.params.id, req.params.contactId))
      return res.status(404).json({ error: 'Contact not found.' });
    const notes = await listNotesForContact(req.params.contactId);
    res.json({ notes });
  } catch (e) {
    res.status(500).json({ error: 'Failed to load notes.' });
  }
});

router.post('/organisations/:id/contacts/:contactId/notes', async (req, res) => {
  try {
    if (!req.body.note_text?.trim()) return res.status(400).json({ error: 'note_text is required.' });
    if (!await organisationBelongsToOrg(orgId(req), req.params.id))
      return res.status(404).json({ error: 'Organisation not found.' });
    if (!await contactBelongsToOrg(req.params.id, req.params.contactId))
      return res.status(404).json({ error: 'Contact not found.' });
    const note = await createNoteForContact(req.params.contactId, req.params.id, req.body.note_text, req.user.id);
    auditFromRequest(req)({
      action: AUDIT_ACTIONS.CRM_NOTE_CREATE,
      targetType: 'crm_note',
      targetId: req.params.id,
      targetOrganizationId: orgId(req),
      metadata: { kind: 'contact note', excerpt: noteExcerpt(req.body.note_text) },
    });
    res.status(201).json({ note });
  } catch (e) {
    res.status(500).json({ error: 'Failed to add note.' });
  }
});

router.delete('/organisations/:id/contacts/:contactId/notes/:noteId', async (req, res) => {
  try {
    if (!await contactBelongsToOrg(req.params.id, req.params.contactId))
      return res.status(404).json({ error: 'Contact not found.' });
    await deleteNote(req.params.noteId, { contactId: req.params.contactId });
    auditFromRequest(req)({
      action: AUDIT_ACTIONS.CRM_NOTE_DELETE,
      targetType: 'crm_note',
      targetId: req.params.id,
      targetOrganizationId: orgId(req),
      metadata: { kind: 'contact note' },
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to delete note.' });
  }
});

// ── Meta ───────────────────────────────────────────────────────────────────

router.get('/meta', (_req, res) => {
  res.json({ businessUnits: BUSINESS_UNITS, leadStatuses: LEAD_STATUSES });
});

export default router;
