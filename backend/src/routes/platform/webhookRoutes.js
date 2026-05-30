import { Router } from 'express';
import * as WebhookEndpoint from '../../models/WebhookEndpoint.js';
import { requirePlatformAdminRole } from '../../middleware/auth.js';
import { query } from '../../config/database.js';

const router = Router();

function publicEndpoint(row, { includeSecret = false } = {}) {
  return {
    id: row.id,
    url: row.url,
    description: row.description,
    events: row.events || [],
    isActive: row.is_active,
    ...(includeSecret ? { signingSecret: row.signing_secret } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// GET /api/platform/webhook-endpoints
router.get('/webhook-endpoints', requirePlatformAdminRole, async (req, res, next) => {
  try {
    const endpoints = await WebhookEndpoint.listEndpoints(req.workspaceOrganization.id);
    res.json({
      endpoints: endpoints.map((e) => publicEndpoint(e)),
      availableEvents: WebhookEndpoint.WEBHOOK_EVENTS,
    });
  } catch (e) { next(e); }
});

// POST /api/platform/webhook-endpoints
router.post('/webhook-endpoints', requirePlatformAdminRole, async (req, res, next) => {
  try {
    const { url, description, events } = req.body;
    if (!url || !String(url).trim().startsWith('http')) {
      return res.status(400).json({ error: 'url must be a valid HTTP/HTTPS URL' });
    }
    const endpoint = await WebhookEndpoint.createEndpoint(req.workspaceOrganization.id, {
      url, description, events: Array.isArray(events) ? events : [], createdBy: req.user.id,
    });
    // Return the signing secret once — it is not shown again in list/get
    res.status(201).json({ endpoint: publicEndpoint(endpoint, { includeSecret: true }) });
  } catch (e) { next(e); }
});

// GET /api/platform/webhook-endpoints/:endpointId
router.get('/webhook-endpoints/:endpointId', requirePlatformAdminRole, async (req, res, next) => {
  try {
    const endpoint = await WebhookEndpoint.getEndpoint(req.params.endpointId);
    if (!endpoint || endpoint.organization_id !== req.workspaceOrganization.id) {
      return res.status(404).json({ error: 'Not found' });
    }
    // Fetch recent dispatch log entries for this endpoint
    const { rows: logs } = await query(
      `SELECT id, event_name, attempt, status, response_status, error_detail, dispatched_at, created_at
       FROM webhook_dispatch_log
       WHERE webhook_endpoint_id = $1
       ORDER BY created_at DESC LIMIT 50`,
      [endpoint.id]
    );
    res.json({ endpoint: publicEndpoint(endpoint), recentDispatches: logs });
  } catch (e) { next(e); }
});

// PATCH /api/platform/webhook-endpoints/:endpointId
router.patch('/webhook-endpoints/:endpointId', requirePlatformAdminRole, async (req, res, next) => {
  try {
    const endpoint = await WebhookEndpoint.getEndpoint(req.params.endpointId);
    if (!endpoint || endpoint.organization_id !== req.workspaceOrganization.id) {
      return res.status(404).json({ error: 'Not found' });
    }
    const { url, description, events, isActive } = req.body;
    const updated = await WebhookEndpoint.updateEndpoint(req.params.endpointId, { url, description, events, isActive });
    res.json({ endpoint: publicEndpoint(updated) });
  } catch (e) { next(e); }
});

// DELETE /api/platform/webhook-endpoints/:endpointId
router.delete('/webhook-endpoints/:endpointId', requirePlatformAdminRole, async (req, res, next) => {
  try {
    const endpoint = await WebhookEndpoint.getEndpoint(req.params.endpointId);
    if (!endpoint || endpoint.organization_id !== req.workspaceOrganization.id) {
      return res.status(404).json({ error: 'Not found' });
    }
    await WebhookEndpoint.deleteEndpoint(req.params.endpointId);
    res.status(204).end();
  } catch (e) { next(e); }
});

export default router;
