import { Router } from 'express';
import * as CrmCustomFilter from '../../models/CrmCustomFilter.js';
import { MAX_PERSONAL_CUSTOM_FILTERS } from '../../models/CrmCustomFilter.js';
import { auditFromRequest, AUDIT_ACTIONS } from '../../services/auditLog.js';

const router = Router();

function orgId(req) { return req.user.organizationId; }
function isAdmin(req) { return req.user?.role === 'admin'; }

// Who may edit/delete a given custom filter: shared filters are admin-only;
// personal filters belong to their owner. Returns an error string or null.
function assertCanManage(req, filter) {
  if (filter.scope === 'shared') {
    return isAdmin(req) ? null : 'Only admins can manage shared custom filters.';
  }
  return filter.owner_user_id === req.user.id ? null : 'You can only manage your own custom filters.';
}

router.get('/custom-filters', async (req, res) => {
  try {
    const customFilters = await CrmCustomFilter.listCustomFiltersForUser(orgId(req), req.user.id);
    // The personal cap only applies to non-admins; -1 signals "no limit" to the
    // client so the tracker can render "used" without a denominator for admins.
    const personalLimit = isAdmin(req) ? -1 : MAX_PERSONAL_CUSTOM_FILTERS;
    res.json({ customFilters, personalLimit });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load custom filters.' });
  }
});

router.post('/custom-filters', async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ error: 'A custom filter name is required.' });

    const scope = CrmCustomFilter.normalizeScope(req.body?.scope);
    if (scope === 'shared' && !isAdmin(req)) {
      return res.status(403).json({ error: 'Only admins can create shared custom filters.' });
    }

    // Cap personal filters for non-admins so a single user can't accumulate an
    // unbounded personal list.
    if (scope === 'personal' && !isAdmin(req)) {
      const count = await CrmCustomFilter.countPersonalCustomFilters(orgId(req), req.user.id);
      if (count >= MAX_PERSONAL_CUSTOM_FILTERS) {
        return res.status(400).json({
          error: `You've reached the limit of ${MAX_PERSONAL_CUSTOM_FILTERS} personal custom filters. Delete one to make room.`,
        });
      }
    }

    const customFilter = await CrmCustomFilter.createCustomFilter(orgId(req), req.body, req.user.id);
    auditFromRequest(req)({
      action: AUDIT_ACTIONS.CUSTOM_FILTER_CREATE,
      targetType: 'crm_custom_filter',
      targetId: String(customFilter.filter_id),
      targetOrganizationId: orgId(req),
      metadata: { name: customFilter.name, scope: customFilter.scope },
    });
    res.status(201).json({ customFilter });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to create custom filter.' });
  }
});

router.patch('/custom-filters/:id', async (req, res) => {
  try {
    const existing = await CrmCustomFilter.getCustomFilter(orgId(req), req.params.id);
    if (!existing) return res.status(404).json({ error: 'Custom filter not found.' });
    const manageError = assertCanManage(req, existing);
    if (manageError) return res.status(403).json({ error: manageError });

    if ('name' in req.body && !String(req.body.name || '').trim()) {
      return res.status(400).json({ error: 'A custom filter name is required.' });
    }

    const customFilter = await CrmCustomFilter.updateCustomFilter(orgId(req), req.params.id, req.body);
    auditFromRequest(req)({
      action: AUDIT_ACTIONS.CUSTOM_FILTER_UPDATE,
      targetType: 'crm_custom_filter',
      targetId: String(req.params.id),
      targetOrganizationId: orgId(req),
      metadata: { name: customFilter.name, patchedFields: Object.keys(req.body || {}) },
    });
    res.json({ customFilter });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to update custom filter.' });
  }
});

router.delete('/custom-filters/:id', async (req, res) => {
  try {
    const existing = await CrmCustomFilter.getCustomFilter(orgId(req), req.params.id);
    if (!existing) return res.status(404).json({ error: 'Custom filter not found.' });
    const manageError = assertCanManage(req, existing);
    if (manageError) return res.status(403).json({ error: manageError });

    await CrmCustomFilter.deleteCustomFilter(orgId(req), req.params.id);
    auditFromRequest(req)({
      action: AUDIT_ACTIONS.CUSTOM_FILTER_DELETE,
      targetType: 'crm_custom_filter',
      targetId: String(req.params.id),
      targetOrganizationId: orgId(req),
      metadata: { name: existing.name, scope: existing.scope },
    });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to delete custom filter.' });
  }
});

export default router;
