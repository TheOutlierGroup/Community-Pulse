import { Router } from 'express';
import * as CrmSegment from '../../models/CrmSegment.js';
import { auditFromRequest, AUDIT_ACTIONS } from '../../services/auditLog.js';

const router = Router();

function orgId(req) { return req.user.organizationId; }
function isAdmin(req) { return req.user?.role === 'admin'; }

// Who may edit/delete a given segment: shared segments are admin-only;
// personal segments belong to their owner. Returns an error string or null.
function assertCanManage(req, segment) {
  if (segment.scope === 'shared') {
    return isAdmin(req) ? null : 'Only admins can manage shared segments.';
  }
  return segment.owner_user_id === req.user.id ? null : 'You can only manage your own segments.';
}

router.get('/segments', async (req, res) => {
  try {
    const segments = await CrmSegment.listSegmentsForUser(orgId(req), req.user.id);
    res.json({ segments });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load segments.' });
  }
});

router.post('/segments', async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ error: 'A segment name is required.' });

    const scope = CrmSegment.normalizeScope(req.body?.scope);
    if (scope === 'shared' && !isAdmin(req)) {
      return res.status(403).json({ error: 'Only admins can create shared segments.' });
    }

    const segment = await CrmSegment.createSegment(orgId(req), req.body, req.user.id);
    auditFromRequest(req)({
      action: AUDIT_ACTIONS.SEGMENT_CREATE,
      targetType: 'crm_segment',
      targetId: String(segment.segment_id),
      targetOrganizationId: orgId(req),
      metadata: { name: segment.name, scope: segment.scope },
    });
    res.status(201).json({ segment });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to create segment.' });
  }
});

router.patch('/segments/:id', async (req, res) => {
  try {
    const existing = await CrmSegment.getSegment(orgId(req), req.params.id);
    if (!existing) return res.status(404).json({ error: 'Segment not found.' });
    const manageError = assertCanManage(req, existing);
    if (manageError) return res.status(403).json({ error: manageError });

    if ('name' in req.body && !String(req.body.name || '').trim()) {
      return res.status(400).json({ error: 'A segment name is required.' });
    }

    const segment = await CrmSegment.updateSegment(orgId(req), req.params.id, req.body);
    auditFromRequest(req)({
      action: AUDIT_ACTIONS.SEGMENT_UPDATE,
      targetType: 'crm_segment',
      targetId: String(req.params.id),
      targetOrganizationId: orgId(req),
      metadata: { name: segment.name, patchedFields: Object.keys(req.body || {}) },
    });
    res.json({ segment });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to update segment.' });
  }
});

router.delete('/segments/:id', async (req, res) => {
  try {
    const existing = await CrmSegment.getSegment(orgId(req), req.params.id);
    if (!existing) return res.status(404).json({ error: 'Segment not found.' });
    const manageError = assertCanManage(req, existing);
    if (manageError) return res.status(403).json({ error: manageError });

    await CrmSegment.deleteSegment(orgId(req), req.params.id);
    auditFromRequest(req)({
      action: AUDIT_ACTIONS.SEGMENT_DELETE,
      targetType: 'crm_segment',
      targetId: String(req.params.id),
      targetOrganizationId: orgId(req),
      metadata: { name: existing.name, scope: existing.scope },
    });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to delete segment.' });
  }
});

export default router;
