import { Router } from 'express';
import * as CrmContact from '../../models/CrmContact.js';
import { assertClientOrganizationPlatformForUser } from './shared.js';
import { auditFromRequest, AUDIT_ACTIONS } from '../../services/auditLog.js';

const router = Router();

function orgId(req) { return req.user.organizationId; }

function contactLabel(contact) {
  return [contact.contact_firstname, contact.contact_lastname].filter(Boolean).join(' ');
}

router.get('/organizations/:orgId/contacts', async (req, res) => {
  try {
    const org = await assertClientOrganizationPlatformForUser(req.params.orgId, req.user);
    if (!org) return res.status(404).json({ error: 'Client not found.' });
    const contacts = await CrmContact.listContactsForClient(org.id);
    res.json({ contacts });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load contacts.' });
  }
});

router.post('/organizations/:orgId/contacts', async (req, res) => {
  try {
    if (!req.body?.contact_firstname?.trim()) {
      return res.status(400).json({ error: 'contact_firstname is required.' });
    }
    const org = await assertClientOrganizationPlatformForUser(req.params.orgId, req.user);
    if (!org) return res.status(404).json({ error: 'Client not found.' });
    const contact = await CrmContact.createContactForClient(org.id, req.body, orgId(req), req.user.id);
    auditFromRequest(req)({
      action: AUDIT_ACTIONS.CLIENT_CONTACT_CREATE,
      targetType: 'organization',
      targetId: org.id,
      targetOrganizationId: org.id,
      metadata: { name: contactLabel(contact) },
    });
    res.status(201).json({ contact });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to create contact.' });
  }
});

router.patch('/organizations/:orgId/contacts/:contactId', async (req, res) => {
  try {
    const org = await assertClientOrganizationPlatformForUser(req.params.orgId, req.user);
    if (!org) return res.status(404).json({ error: 'Client not found.' });
    if (!await CrmContact.contactBelongsToClientOrg(org.id, req.params.contactId)) {
      return res.status(404).json({ error: 'Contact not found.' });
    }
    const contact = await CrmContact.updateContactForClient(req.params.contactId, org.id, req.body);
    auditFromRequest(req)({
      action: AUDIT_ACTIONS.CLIENT_CONTACT_UPDATE,
      targetType: 'organization',
      targetId: org.id,
      targetOrganizationId: org.id,
      metadata: { name: contactLabel(contact), patchedFields: Object.keys(req.body || {}) },
    });
    res.json({ contact });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to update contact.' });
  }
});

router.delete('/organizations/:orgId/contacts/:contactId', async (req, res) => {
  try {
    const org = await assertClientOrganizationPlatformForUser(req.params.orgId, req.user);
    if (!org) return res.status(404).json({ error: 'Client not found.' });
    if (!await CrmContact.contactBelongsToClientOrg(org.id, req.params.contactId)) {
      return res.status(404).json({ error: 'Contact not found.' });
    }
    const deleted = await CrmContact.deleteContactForClient(req.params.contactId, org.id, req.user.id);
    if (!deleted) return res.status(404).json({ error: 'Contact not found.' });
    auditFromRequest(req)({
      action: AUDIT_ACTIONS.CLIENT_CONTACT_DELETE,
      targetType: 'organization',
      targetId: org.id,
      targetOrganizationId: org.id,
      metadata: { name: contactLabel(deleted) },
    });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to delete contact.' });
  }
});

router.get('/organizations/:orgId/contacts/deleted', async (req, res) => {
  try {
    const org = await assertClientOrganizationPlatformForUser(req.params.orgId, req.user);
    if (!org) return res.status(404).json({ error: 'Client not found.' });
    const contacts = await CrmContact.listDeletedContactsForClient(org.id);
    res.json({ contacts });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load recently deleted contacts.' });
  }
});

router.post('/organizations/:orgId/contacts/:contactId/restore', async (req, res) => {
  try {
    const org = await assertClientOrganizationPlatformForUser(req.params.orgId, req.user);
    if (!org) return res.status(404).json({ error: 'Client not found.' });
    const contact = await CrmContact.restoreContactForClient(req.params.contactId, org.id);
    if (!contact) return res.status(404).json({ error: 'Deleted contact not found.' });
    auditFromRequest(req)({
      action: AUDIT_ACTIONS.CLIENT_CONTACT_RESTORE,
      targetType: 'organization',
      targetId: org.id,
      targetOrganizationId: org.id,
      metadata: { name: contactLabel(contact) },
    });
    res.json({ contact });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to restore contact.' });
  }
});

export default router;
