import { Router } from 'express';
import { requirePlatformAdminRole } from '../../middleware/auth.js';
import * as PlatformStatusIncident from '../../models/PlatformStatusIncident.js';
import { auditFromRequest, AUDIT_ACTIONS } from '../../services/auditLog.js';

/**
 * INF-08: platform-admin CRUD for status incidents. Only Outlier
 * platform admins can create / resolve incidents — licensees and clients
 * see them via the public `/api/status` feed.
 */
const router = Router();

function ensurePlatformAdmin(req, res) {
  if (req.workspaceOrganization?.kind !== 'platform') {
    res.status(403).json({ error: 'Only platform admins can manage status incidents' });
    return false;
  }
  return true;
}

router.get('/status-incidents', requirePlatformAdminRole, async (req, res, next) => {
  if (!ensurePlatformAdmin(req, res)) return;
  try {
    const includeResolved = String(req.query?.includeResolved || 'true').toLowerCase() !== 'false';
    const rows = await PlatformStatusIncident.listIncidents({
      includeResolved,
      limit: Number.parseInt(req.query?.limit, 10) || 100,
    });
    res.json({ incidents: rows.map(PlatformStatusIncident.publicIncident) });
  } catch (error) {
    next(error);
  }
});

router.post('/status-incidents', requirePlatformAdminRole, async (req, res, next) => {
  if (!ensurePlatformAdmin(req, res)) return;
  try {
    const { title, body, severity, components } = req.body || {};
    if (!String(title || '').trim() || !String(body || '').trim()) {
      return res.status(400).json({ error: 'title and body are required' });
    }
    if (severity && !PlatformStatusIncident.SEVERITIES.includes(severity)) {
      return res.status(400).json({
        error: `severity must be one of: ${PlatformStatusIncident.SEVERITIES.join(', ')}`,
      });
    }
    const row = await PlatformStatusIncident.createIncident({
      title,
      body,
      severity,
      components,
      createdBy: req.user?.id || null,
    });
    auditFromRequest(req)({
      action: AUDIT_ACTIONS.STATUS_INCIDENT_CREATE,
      targetType: 'status_incident',
      targetId: row.id,
      metadata: { severity: row.severity, title: row.title },
    });
    res.status(201).json({ incident: PlatformStatusIncident.publicIncident(row) });
  } catch (error) {
    next(error);
  }
});

router.patch('/status-incidents/:id', requirePlatformAdminRole, async (req, res, next) => {
  if (!ensurePlatformAdmin(req, res)) return;
  try {
    const body = req.body || {};
    if (body.severity && !PlatformStatusIncident.SEVERITIES.includes(body.severity)) {
      return res.status(400).json({
        error: `severity must be one of: ${PlatformStatusIncident.SEVERITIES.join(', ')}`,
      });
    }
    const updated = await PlatformStatusIncident.updateIncident(req.params.id, body);
    if (!updated) return res.status(404).json({ error: 'Incident not found' });
    auditFromRequest(req)({
      action: AUDIT_ACTIONS.STATUS_INCIDENT_UPDATE,
      targetType: 'status_incident',
      targetId: updated.id,
      metadata: { patchedFields: Object.keys(body) },
    });
    res.json({ incident: PlatformStatusIncident.publicIncident(updated) });
  } catch (error) {
    next(error);
  }
});

router.post('/status-incidents/:id/resolve', requirePlatformAdminRole, async (req, res, next) => {
  if (!ensurePlatformAdmin(req, res)) return;
  try {
    const updated = await PlatformStatusIncident.updateIncident(req.params.id, {
      resolvedAt: new Date().toISOString(),
    });
    if (!updated) return res.status(404).json({ error: 'Incident not found' });
    auditFromRequest(req)({
      action: AUDIT_ACTIONS.STATUS_INCIDENT_RESOLVE,
      targetType: 'status_incident',
      targetId: updated.id,
    });
    res.json({ incident: PlatformStatusIncident.publicIncident(updated) });
  } catch (error) {
    next(error);
  }
});

router.delete('/status-incidents/:id', requirePlatformAdminRole, async (req, res, next) => {
  if (!ensurePlatformAdmin(req, res)) return;
  try {
    const ok = await PlatformStatusIncident.deleteIncident(req.params.id);
    if (!ok) return res.status(404).json({ error: 'Incident not found' });
    auditFromRequest(req)({
      action: AUDIT_ACTIONS.STATUS_INCIDENT_DELETE,
      targetType: 'status_incident',
      targetId: req.params.id,
    });
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

export default router;
