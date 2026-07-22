import { Router } from 'express';
import * as Campaign from '../../models/Campaign.js';
import { getCustomFilter } from '../../models/CrmCustomFilter.js';
import { auditFromRequest, AUDIT_ACTIONS } from '../../services/auditLog.js';

const router = Router();

function orgId(req) { return req.user.organizationId; }

// A stage's WHO must point at a custom filter in the same workspace. Returns an
// error string or null.
async function assertWhoFilter(req, data) {
  if (data.who_filter_id === undefined || data.who_filter_id === null || data.who_filter_id === '') return null;
  const id = Number(data.who_filter_id);
  if (!Number.isInteger(id)) return 'Invalid custom filter.';
  const filter = await getCustomFilter(orgId(req), id);
  if (!filter) return 'Custom filter not found in this workspace.';
  return null;
}

router.get('/campaigns', async (req, res) => {
  try {
    const campaigns = await Campaign.listCampaignsWithStages(orgId(req));
    res.json({ campaigns });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load campaigns.' });
  }
});

router.get('/campaigns/:id', async (req, res) => {
  try {
    const campaign = await Campaign.getCampaignWithStages(orgId(req), req.params.id);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found.' });
    res.json({ campaign });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load campaign.' });
  }
});

router.post('/campaigns', async (req, res) => {
  try {
    if (!String(req.body?.name || '').trim()) {
      return res.status(400).json({ error: 'A campaign name is required.' });
    }
    const campaign = await Campaign.createCampaign(orgId(req), req.body, req.user.id);
    auditFromRequest(req)({
      action: AUDIT_ACTIONS.CAMPAIGN_CREATE,
      targetType: 'campaign',
      targetId: String(campaign.campaign_id),
      targetOrganizationId: orgId(req),
      metadata: { name: campaign.name },
    });
    res.status(201).json({ campaign: { ...campaign, stages: [] } });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to create campaign.' });
  }
});

router.patch('/campaigns/:id', async (req, res) => {
  try {
    const existing = await Campaign.getCampaign(orgId(req), req.params.id);
    if (!existing) return res.status(404).json({ error: 'Campaign not found.' });
    if ('name' in req.body && !String(req.body.name || '').trim()) {
      return res.status(400).json({ error: 'A campaign name is required.' });
    }
    const campaign = await Campaign.updateCampaign(orgId(req), req.params.id, req.body);
    auditFromRequest(req)({
      action: AUDIT_ACTIONS.CAMPAIGN_UPDATE,
      targetType: 'campaign',
      targetId: String(req.params.id),
      targetOrganizationId: orgId(req),
      metadata: { name: campaign.name, patchedFields: Object.keys(req.body || {}) },
    });
    res.json({ campaign });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to update campaign.' });
  }
});

router.delete('/campaigns/:id', async (req, res) => {
  try {
    const existing = await Campaign.getCampaign(orgId(req), req.params.id);
    if (!existing) return res.status(404).json({ error: 'Campaign not found.' });
    await Campaign.deleteCampaign(orgId(req), req.params.id);
    auditFromRequest(req)({
      action: AUDIT_ACTIONS.CAMPAIGN_DELETE,
      targetType: 'campaign',
      targetId: String(req.params.id),
      targetOrganizationId: orgId(req),
      metadata: { name: existing.name },
    });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to delete campaign.' });
  }
});

// ── Stages ───────────────────────────────────────────────────────────────

router.post('/campaigns/:id/stages', async (req, res) => {
  try {
    const campaign = await Campaign.getCampaign(orgId(req), req.params.id);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found.' });
    if (!String(req.body?.name || '').trim()) {
      return res.status(400).json({ error: 'A stage name is required.' });
    }
    const whoError = await assertWhoFilter(req, req.body);
    if (whoError) return res.status(400).json({ error: whoError });

    const stage = await Campaign.createStage(campaign.campaign_id, req.body);
    auditFromRequest(req)({
      action: AUDIT_ACTIONS.CAMPAIGN_STAGE_CREATE,
      targetType: 'campaign_stage',
      targetId: String(stage.stage_id),
      targetOrganizationId: orgId(req),
      metadata: { campaignId: campaign.campaign_id, name: stage.name },
    });
    res.status(201).json({ stage });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to create stage.' });
  }
});

router.patch('/campaigns/:id/stages/:stageId', async (req, res) => {
  try {
    const existing = await Campaign.getStage(orgId(req), req.params.stageId);
    if (!existing || String(existing.campaign_id) !== String(req.params.id)) {
      return res.status(404).json({ error: 'Stage not found.' });
    }
    if ('name' in req.body && !String(req.body.name || '').trim()) {
      return res.status(400).json({ error: 'A stage name is required.' });
    }
    const whoError = await assertWhoFilter(req, req.body);
    if (whoError) return res.status(400).json({ error: whoError });

    const stage = await Campaign.updateStage(orgId(req), req.params.stageId, req.body);
    auditFromRequest(req)({
      action: AUDIT_ACTIONS.CAMPAIGN_STAGE_UPDATE,
      targetType: 'campaign_stage',
      targetId: String(req.params.stageId),
      targetOrganizationId: orgId(req),
      metadata: { campaignId: req.params.id, patchedFields: Object.keys(req.body || {}) },
    });
    res.json({ stage });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to update stage.' });
  }
});

router.delete('/campaigns/:id/stages/:stageId', async (req, res) => {
  try {
    const existing = await Campaign.getStage(orgId(req), req.params.stageId);
    if (!existing || String(existing.campaign_id) !== String(req.params.id)) {
      return res.status(404).json({ error: 'Stage not found.' });
    }
    await Campaign.deleteStage(orgId(req), req.params.stageId);
    auditFromRequest(req)({
      action: AUDIT_ACTIONS.CAMPAIGN_STAGE_DELETE,
      targetType: 'campaign_stage',
      targetId: String(req.params.stageId),
      targetOrganizationId: orgId(req),
      metadata: { campaignId: req.params.id, name: existing.name },
    });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to delete stage.' });
  }
});

export default router;
