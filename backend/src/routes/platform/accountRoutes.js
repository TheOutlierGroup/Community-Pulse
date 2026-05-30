import { Router } from 'express';
import * as Account from '../../models/Account.js';

const router = Router();

function publicAccount(row) {
  return {
    id: row.id,
    name: row.name,
    website: row.website,
    industry: row.industry,
    address: row.address,
    notes: row.notes,
    customFields: row.custom_fields || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function publicContact(row) {
  return {
    id: row.id,
    accountId: row.account_id,
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email,
    phone: row.phone,
    jobTitle: row.job_title,
    isPrimary: row.is_primary,
    notes: row.notes,
    customFields: row.custom_fields || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ── Accounts ──────────────────────────────────────────────────────────────────

// GET /api/platform/accounts
router.get('/', async (req, res, next) => {
  try {
    const { search, limit, offset } = req.query;
    const accounts = await Account.listAccounts(req.workspaceOrganization.id, { search, limit, offset });
    res.json({ accounts: accounts.map(publicAccount) });
  } catch (e) { next(e); }
});

// POST /api/platform/accounts
router.post('/', async (req, res, next) => {
  try {
    const { name, website, industry, address, notes, customFields } = req.body;
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'name is required' });
    const account = await Account.createAccount(req.workspaceOrganization.id, {
      name, website, industry, address, notes, customFields, createdBy: req.user.id,
    });
    res.status(201).json({ account: publicAccount(account) });
  } catch (e) { next(e); }
});

// GET /api/platform/accounts/:accountId
router.get('/:accountId', async (req, res, next) => {
  try {
    const account = await Account.getAccount(req.params.accountId);
    if (!account || account.organization_id !== req.workspaceOrganization.id) return res.status(404).json({ error: 'Not found' });
    const contacts = await Account.listContacts(account.id);
    res.json({ account: publicAccount(account), contacts: contacts.map(publicContact) });
  } catch (e) { next(e); }
});

// PATCH /api/platform/accounts/:accountId
router.patch('/:accountId', async (req, res, next) => {
  try {
    const account = await Account.getAccount(req.params.accountId);
    if (!account || account.organization_id !== req.workspaceOrganization.id) return res.status(404).json({ error: 'Not found' });
    const updated = await Account.updateAccount(req.params.accountId, req.body);
    res.json({ account: publicAccount(updated) });
  } catch (e) { next(e); }
});

// DELETE /api/platform/accounts/:accountId
router.delete('/:accountId', async (req, res, next) => {
  try {
    const account = await Account.getAccount(req.params.accountId);
    if (!account || account.organization_id !== req.workspaceOrganization.id) return res.status(404).json({ error: 'Not found' });
    await Account.deleteAccount(req.params.accountId);
    res.status(204).end();
  } catch (e) { next(e); }
});

// ── Contacts ──────────────────────────────────────────────────────────────────

// POST /api/platform/accounts/:accountId/contacts
router.post('/:accountId/contacts', async (req, res, next) => {
  try {
    const account = await Account.getAccount(req.params.accountId);
    if (!account || account.organization_id !== req.workspaceOrganization.id) return res.status(404).json({ error: 'Not found' });
    const { firstName, lastName, email, phone, jobTitle, isPrimary, notes, customFields } = req.body;
    if (!firstName || !lastName) return res.status(400).json({ error: 'firstName and lastName are required' });
    const contact = await Account.createContact(account.id, {
      firstName, lastName, email, phone, jobTitle, isPrimary, notes, customFields, createdBy: req.user.id,
    });
    res.status(201).json({ contact: publicContact(contact) });
  } catch (e) { next(e); }
});

// PATCH /api/platform/accounts/:accountId/contacts/:contactId
router.patch('/:accountId/contacts/:contactId', async (req, res, next) => {
  try {
    const account = await Account.getAccount(req.params.accountId);
    if (!account || account.organization_id !== req.workspaceOrganization.id) return res.status(404).json({ error: 'Not found' });
    const contact = await Account.getContact(req.params.contactId);
    if (!contact || String(contact.account_id) !== String(account.id)) return res.status(404).json({ error: 'Contact not found' });
    const updated = await Account.updateContact(req.params.contactId, req.body);
    res.json({ contact: publicContact(updated) });
  } catch (e) { next(e); }
});

// DELETE /api/platform/accounts/:accountId/contacts/:contactId
router.delete('/:accountId/contacts/:contactId', async (req, res, next) => {
  try {
    const account = await Account.getAccount(req.params.accountId);
    if (!account || account.organization_id !== req.workspaceOrganization.id) return res.status(404).json({ error: 'Not found' });
    const contact = await Account.getContact(req.params.contactId);
    if (!contact || String(contact.account_id) !== String(account.id)) return res.status(404).json({ error: 'Contact not found' });
    await Account.deleteContact(req.params.contactId);
    res.status(204).end();
  } catch (e) { next(e); }
});

export default router;
