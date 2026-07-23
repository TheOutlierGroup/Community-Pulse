import { Router } from 'express';
import * as CrmContact from '../../models/CrmContact.js';
import { organisationBelongsToOrg } from '../../models/CrmOrganisation.js';
import { auditFromRequest, AUDIT_ACTIONS } from '../../services/auditLog.js';
import { assertClientOrganizationPlatformForUser } from './shared.js';
import { importContacts } from '../../services/contactImport.js';

const router = Router();

function orgId(req) { return req.user.organizationId; }

function contactLabel(contact) {
  return [contact.contact_firstname, contact.contact_lastname].filter(Boolean).join(' ');
}

async function assertLinksBelongToWorkspace(req, data) {
  if (data.crm_organisation_id) {
    if (!await organisationBelongsToOrg(orgId(req), data.crm_organisation_id)) {
      return 'Linked prospect not found.';
    }
  }
  if (data.client_organization_id) {
    const client = await assertClientOrganizationPlatformForUser(data.client_organization_id, req.user);
    if (!client) return 'Linked client not found.';
  }
  return null;
}

router.get('/contacts', async (req, res) => {
  try {
    const contacts = await CrmContact.listAllContacts(orgId(req), {
      search: req.query.search,
      linkType: req.query.linkType,
      businessUnit: req.query.businessUnit,
    });
    res.json({ contacts });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load contacts.' });
  }
});

// Bulk CSV import (MeetAlfred/LinkedIn or Firmable). The frontend parses the
// CSV and sends normalised rows; matching, enrichment and manual-field
// protection happen server-side (services/contactImport.js).
router.post('/contacts/import', async (req, res) => {
  try {
    const source = String(req.body?.source || '').trim();
    const summary = await importContacts(orgId(req), source, req.body?.rows, req.user.id);
    auditFromRequest(req)({
      action: AUDIT_ACTIONS.CONTACT_IMPORT,
      targetType: 'crm_contact',
      targetId: 'bulk',
      targetOrganizationId: orgId(req),
      metadata: summary,
    });
    res.json({ summary });
  } catch (e) {
    if (e.status === 400) return res.status(400).json({ error: e.message });
    console.error(e);
    res.status(500).json({ error: 'Failed to import contacts.' });
  }
});

router.post('/contacts', async (req, res) => {
  try {
    if (!req.body?.contact_firstname?.trim()) {
      return res.status(400).json({ error: 'contact_firstname is required.' });
    }
    const linkError = await assertLinksBelongToWorkspace(req, req.body);
    if (linkError) return res.status(400).json({ error: linkError });

    const contact = await CrmContact.createContactGlobal(orgId(req), req.body, req.user.id);
    auditFromRequest(req)({
      action: AUDIT_ACTIONS.CONTACT_CREATE,
      targetType: 'crm_contact',
      targetId: String(contact.contact_id),
      targetOrganizationId: orgId(req),
      metadata: { name: contactLabel(contact) },
    });
    res.status(201).json({ contact });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to create contact.' });
  }
});

router.patch('/contacts/:id', async (req, res) => {
  try {
    const existing = await CrmContact.getContactGlobal(orgId(req), req.params.id);
    if (!existing) return res.status(404).json({ error: 'Contact not found.' });
    const linkError = await assertLinksBelongToWorkspace(req, req.body);
    if (linkError) return res.status(400).json({ error: linkError });

    const contact = await CrmContact.updateContactGlobal(orgId(req), req.params.id, req.body);
    auditFromRequest(req)({
      action: AUDIT_ACTIONS.CONTACT_UPDATE,
      targetType: 'crm_contact',
      targetId: String(req.params.id),
      targetOrganizationId: orgId(req),
      metadata: { name: contactLabel(contact), patchedFields: Object.keys(req.body || {}) },
    });
    res.json({ contact });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to update contact.' });
  }
});

router.delete('/contacts/:id', async (req, res) => {
  try {
    const existing = await CrmContact.getContactGlobal(orgId(req), req.params.id);
    if (!existing) return res.status(404).json({ error: 'Contact not found.' });
    await CrmContact.deleteContactGlobal(orgId(req), req.params.id, req.user.id);
    auditFromRequest(req)({
      action: AUDIT_ACTIONS.CONTACT_DELETE,
      targetType: 'crm_contact',
      targetId: String(req.params.id),
      targetOrganizationId: orgId(req),
      metadata: { name: contactLabel(existing) },
    });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to delete contact.' });
  }
});

router.get('/contacts/deleted', async (req, res) => {
  try {
    const contacts = await CrmContact.listDeletedContactsGlobal(orgId(req));
    res.json({ contacts });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load recently deleted contacts.' });
  }
});

router.post('/contacts/:id/restore', async (req, res) => {
  try {
    const contact = await CrmContact.restoreContactGlobal(orgId(req), req.params.id);
    if (!contact) return res.status(404).json({ error: 'Deleted contact not found.' });
    auditFromRequest(req)({
      action: AUDIT_ACTIONS.CONTACT_RESTORE,
      targetType: 'crm_contact',
      targetId: String(req.params.id),
      targetOrganizationId: orgId(req),
      metadata: { name: contactLabel(contact) },
    });
    res.json({ contact });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to restore contact.' });
  }
});

export default router;
