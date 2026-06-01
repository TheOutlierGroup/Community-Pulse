import { Router } from 'express';
import {
  listOrganisations, getOrganisation, createOrganisation,
  updateOrganisation, deleteOrganisation, organisationBelongsToOrg,
  BUSINESS_UNITS, LEAD_STATUSES,
} from '../../models/CrmOrganisation.js';
import { listContacts, createContact, updateContact, deleteContact, contactBelongsToOrg } from '../../models/CrmContact.js';
import {
  listNotesForOrg, listNotesForContact,
  createNoteForOrg, createNoteForContact, deleteNote,
} from '../../models/CrmNote.js';

const router = Router();

function orgId(req) { return req.user.organizationId; }

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
    res.json({ organisation: org });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to update organisation.' });
  }
});

router.delete('/organisations/:id', async (req, res) => {
  try {
    if (!await organisationBelongsToOrg(orgId(req), req.params.id))
      return res.status(404).json({ error: 'Organisation not found.' });
    await deleteOrganisation(orgId(req), req.params.id);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to delete organisation.' });
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
