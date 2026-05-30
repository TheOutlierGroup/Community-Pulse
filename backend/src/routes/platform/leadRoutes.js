import { Router } from 'express';
import * as Lead from '../../models/Lead.js';
import * as PipelineStage from '../../models/PipelineStage.js';
import * as BusinessUnit from '../../models/BusinessUnit.js';
import * as Account from '../../models/Account.js';
import { requirePlatformAdminRole } from '../../middleware/auth.js';
import { logActivity } from '../../models/Lead.js';
import { dispatchEvent } from '../../services/webhookDispatchService.js';

const router = Router();

function publicLead(row) {
  return {
    id: row.id,
    organizationId: row.organization_id,
    businessUnitId: row.business_unit_id,
    buName: row.bu_name,
    accountId: row.account_id,
    accountName: row.account_name,
    contactId: row.contact_id,
    contactName: row.contact_name,
    contactEmail: row.contact_email,
    pipelineStageId: row.pipeline_stage_id,
    stageName: row.stage_name,
    stageIsWon: row.stage_is_won,
    stageIsLost: row.stage_is_lost,
    title: row.title,
    description: row.description,
    source: row.source,
    assignedTo: row.assigned_to,
    expectedCloseDate: row.expected_close_date,
    customFields: row.custom_fields || {},
    lockedAt: row.locked_at,
    wonAt: row.won_at,
    lostAt: row.lost_at,
    lostReason: row.lost_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function publicStage(row) {
  return {
    id: row.id,
    businessUnitId: row.business_unit_id,
    name: row.name,
    position: row.position,
    isWon: row.is_won,
    isLost: row.is_lost,
    createdAt: row.created_at,
  };
}

function publicActivity(row) {
  return {
    id: row.id,
    leadId: row.lead_id,
    actorId: row.actor_id,
    actorEmail: row.actor_email,
    actorName: row.actor_first_name ? `${row.actor_first_name} ${row.actor_last_name}`.trim() : null,
    eventType: row.event_type,
    payload: row.payload || {},
    createdAt: row.created_at,
  };
}

// ── Pipeline stage config (per BU) ────────────────────────────────────────────

// GET /api/platform/business-units/:buId/pipeline-stages
router.get('/business-units/:buId/pipeline-stages', async (req, res, next) => {
  try {
    const bu = await BusinessUnit.getBusinessUnit(req.params.buId);
    if (!bu || bu.organization_id !== req.workspaceOrganization.id) return res.status(404).json({ error: 'Not found' });
    const stages = await PipelineStage.listStages(req.params.buId);
    res.json({ stages: stages.map(publicStage) });
  } catch (e) { next(e); }
});

// POST /api/platform/business-units/:buId/pipeline-stages  (admin only)
router.post('/business-units/:buId/pipeline-stages', requirePlatformAdminRole, async (req, res, next) => {
  try {
    const bu = await BusinessUnit.getBusinessUnit(req.params.buId);
    if (!bu || bu.organization_id !== req.workspaceOrganization.id) return res.status(404).json({ error: 'Not found' });
    const { name, position, isWon, isLost } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    if (position == null) return res.status(400).json({ error: 'position is required' });
    const stage = await PipelineStage.createStage(req.params.buId, { name, position, isWon, isLost });
    res.status(201).json({ stage: publicStage(stage) });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'A stage at that position or with that name already exists' });
    next(e);
  }
});

// PATCH /api/platform/business-units/:buId/pipeline-stages/:stageId  (admin only)
router.patch('/business-units/:buId/pipeline-stages/:stageId', requirePlatformAdminRole, async (req, res, next) => {
  try {
    const bu = await BusinessUnit.getBusinessUnit(req.params.buId);
    if (!bu || bu.organization_id !== req.workspaceOrganization.id) return res.status(404).json({ error: 'Not found' });
    const valid = await PipelineStage.stageBelongsToBusinessUnit(req.params.stageId, req.params.buId);
    if (!valid) return res.status(404).json({ error: 'Stage not found' });
    const updated = await PipelineStage.updateStage(req.params.stageId, req.body);
    res.json({ stage: publicStage(updated) });
  } catch (e) { next(e); }
});

// DELETE /api/platform/business-units/:buId/pipeline-stages/:stageId  (admin only)
router.delete('/business-units/:buId/pipeline-stages/:stageId', requirePlatformAdminRole, async (req, res, next) => {
  try {
    const bu = await BusinessUnit.getBusinessUnit(req.params.buId);
    if (!bu || bu.organization_id !== req.workspaceOrganization.id) return res.status(404).json({ error: 'Not found' });
    const valid = await PipelineStage.stageBelongsToBusinessUnit(req.params.stageId, req.params.buId);
    if (!valid) return res.status(404).json({ error: 'Stage not found' });
    await PipelineStage.deleteStage(req.params.stageId);
    res.status(204).end();
  } catch (e) { next(e); }
});

// ── Leads ─────────────────────────────────────────────────────────────────────

// GET /api/platform/leads
router.get('/leads', async (req, res, next) => {
  try {
    const { businessUnitId, pipelineStageId, assignedTo, search, wonOnly, lostOnly, openOnly, limit, offset } = req.query;
    const leads = await Lead.listLeads(req.workspaceOrganization.id, {
      businessUnitId, pipelineStageId, assignedTo, search,
      wonOnly: wonOnly === 'true', lostOnly: lostOnly === 'true', openOnly: openOnly === 'true',
      limit, offset,
    });
    res.json({ leads: leads.map(publicLead) });
  } catch (e) { next(e); }
});

// POST /api/platform/leads
router.post('/leads', async (req, res, next) => {
  try {
    const {
      businessUnitId, accountId, contactId, pipelineStageId,
      title, description, source, sourceMetadata, assignedTo, expectedCloseDate, customFields,
    } = req.body;

    if (!businessUnitId || !accountId || !contactId || !pipelineStageId || !title) {
      return res.status(400).json({ error: 'businessUnitId, accountId, contactId, pipelineStageId, and title are required' });
    }

    const [buOk, acctOk, stageOk] = await Promise.all([
      BusinessUnit.businessUnitBelongsToOrg(businessUnitId, req.workspaceOrganization.id),
      Account.accountBelongsToOrg(accountId, req.workspaceOrganization.id),
      PipelineStage.stageBelongsToBusinessUnit(pipelineStageId, businessUnitId),
    ]);
    if (!buOk) return res.status(400).json({ error: 'Business unit not found' });
    if (!acctOk) return res.status(400).json({ error: 'Account not found' });
    if (!stageOk) return res.status(400).json({ error: 'Pipeline stage not found in this business unit' });

    const lead = await Lead.createLead(req.workspaceOrganization.id, {
      businessUnitId, accountId, contactId, pipelineStageId,
      title, description, source, sourceMetadata, assignedTo, expectedCloseDate, customFields,
      createdBy: req.user.id,
    });
    await logActivity(lead.id, req.user.id, Lead.LEAD_ACTIVITY_TYPES.CREATED, { title: lead.title });
    const full = await Lead.getLead(lead.id);
    dispatchEvent(req.workspaceOrganization.id, 'lead.created', {
      leadId: full.id, title: full.title, businessUnitId: full.business_unit_id, buName: full.bu_name,
    });
    res.status(201).json({ lead: publicLead(full) });
  } catch (e) { next(e); }
});

// GET /api/platform/leads/:leadId
router.get('/leads/:leadId', async (req, res, next) => {
  try {
    const lead = await Lead.getLead(req.params.leadId);
    if (!lead || lead.organization_id !== req.workspaceOrganization.id) return res.status(404).json({ error: 'Not found' });
    const [estimates, totals] = await Promise.all([
      Lead.listEstimates(lead.id),
      Lead.sumEstimates(lead.id),
    ]);
    res.json({ lead: publicLead(lead), estimates, totals });
  } catch (e) { next(e); }
});

// PATCH /api/platform/leads/:leadId
router.patch('/leads/:leadId', async (req, res, next) => {
  try {
    const lead = await Lead.getLead(req.params.leadId);
    if (!lead || lead.organization_id !== req.workspaceOrganization.id) return res.status(404).json({ error: 'Not found' });
    if (lead.locked_at) return res.status(409).json({ error: 'Lead is locked after Mark as Won and cannot be edited' });

    const before = { pipelineStageId: lead.pipeline_stage_id, assignedTo: lead.assigned_to };
    const updated = await Lead.updateLead(req.params.leadId, req.body);
    if (!updated) return res.status(404).json({ error: 'Not found' });

    if (req.body.pipelineStageId && req.body.pipelineStageId !== before.pipelineStageId) {
      await logActivity(lead.id, req.user.id, Lead.LEAD_ACTIVITY_TYPES.STAGE_CHANGED, {
        from: before.pipelineStageId, to: req.body.pipelineStageId,
      });
    }
    if (req.body.assignedTo !== undefined && req.body.assignedTo !== before.assignedTo) {
      await logActivity(lead.id, req.user.id, Lead.LEAD_ACTIVITY_TYPES.ASSIGNED, {
        from: before.assignedTo, to: req.body.assignedTo,
      });
    }
    const full = await Lead.getLead(updated.id);
    res.json({ lead: publicLead(full) });
  } catch (e) { next(e); }
});

// POST /api/platform/leads/:leadId/mark-won
router.post('/leads/:leadId/mark-won', async (req, res, next) => {
  try {
    const lead = await Lead.getLead(req.params.leadId);
    if (!lead || lead.organization_id !== req.workspaceOrganization.id) return res.status(404).json({ error: 'Not found' });
    if (lead.locked_at) return res.status(409).json({ error: 'Lead is already marked as Won' });
    if (lead.lost_at) return res.status(409).json({ error: 'Lead is already marked as Lost' });

    const won = await Lead.markLeadWon(req.params.leadId, req.user.id);
    if (!won) return res.status(409).json({ error: 'Could not mark lead as won' });
    await logActivity(won.id, req.user.id, Lead.LEAD_ACTIVITY_TYPES.WON, {});
    const full = await Lead.getLead(won.id);
    dispatchEvent(req.workspaceOrganization.id, 'lead.won', { leadId: full.id, title: full.title });
    res.json({ lead: publicLead(full) });
  } catch (e) { next(e); }
});

// POST /api/platform/leads/:leadId/mark-lost
router.post('/leads/:leadId/mark-lost', async (req, res, next) => {
  try {
    const lead = await Lead.getLead(req.params.leadId);
    if (!lead || lead.organization_id !== req.workspaceOrganization.id) return res.status(404).json({ error: 'Not found' });
    if (lead.won_at) return res.status(409).json({ error: 'Lead is already marked as Won' });
    if (lead.lost_at) return res.status(409).json({ error: 'Lead is already marked as Lost' });

    const lost = await Lead.markLeadLost(req.params.leadId, req.body.reason);
    if (!lost) return res.status(409).json({ error: 'Could not mark lead as lost' });
    await logActivity(lost.id, req.user.id, Lead.LEAD_ACTIVITY_TYPES.LOST, { reason: req.body.reason });
    const full = await Lead.getLead(lost.id);
    dispatchEvent(req.workspaceOrganization.id, 'lead.lost', { leadId: full.id, title: full.title, reason: req.body.reason || null });
    res.json({ lead: publicLead(full) });
  } catch (e) { next(e); }
});

// ── Estimates ─────────────────────────────────────────────────────────────────

// POST /api/platform/leads/:leadId/estimates
router.post('/leads/:leadId/estimates', async (req, res, next) => {
  try {
    const lead = await Lead.getLead(req.params.leadId);
    if (!lead || lead.organization_id !== req.workspaceOrganization.id) return res.status(404).json({ error: 'Not found' });
    if (lead.locked_at) return res.status(409).json({ error: 'Lead is locked and cannot be modified' });
    const { description, hours, unitCost, quantity, position } = req.body;
    if (!description) return res.status(400).json({ error: 'description is required' });
    const estimate = await Lead.addEstimate(lead.id, { description, hours, unitCost, quantity, position });
    await logActivity(lead.id, req.user.id, Lead.LEAD_ACTIVITY_TYPES.ESTIMATE_ADDED, { description });
    res.status(201).json({ estimate });
  } catch (e) { next(e); }
});

// PATCH /api/platform/leads/:leadId/estimates/:estimateId
router.patch('/leads/:leadId/estimates/:estimateId', async (req, res, next) => {
  try {
    const lead = await Lead.getLead(req.params.leadId);
    if (!lead || lead.organization_id !== req.workspaceOrganization.id) return res.status(404).json({ error: 'Not found' });
    if (lead.locked_at) return res.status(409).json({ error: 'Lead is locked and cannot be modified' });
    const updated = await Lead.updateEstimate(req.params.estimateId, req.body);
    if (!updated) return res.status(404).json({ error: 'Estimate not found' });
    res.json({ estimate: updated });
  } catch (e) { next(e); }
});

// DELETE /api/platform/leads/:leadId/estimates/:estimateId
router.delete('/leads/:leadId/estimates/:estimateId', async (req, res, next) => {
  try {
    const lead = await Lead.getLead(req.params.leadId);
    if (!lead || lead.organization_id !== req.workspaceOrganization.id) return res.status(404).json({ error: 'Not found' });
    if (lead.locked_at) return res.status(409).json({ error: 'Lead is locked and cannot be modified' });
    await Lead.deleteEstimate(req.params.estimateId);
    await logActivity(lead.id, req.user.id, Lead.LEAD_ACTIVITY_TYPES.ESTIMATE_REMOVED, {});
    res.status(204).end();
  } catch (e) { next(e); }
});

// ── Activity ──────────────────────────────────────────────────────────────────

// GET /api/platform/leads/:leadId/activity
router.get('/leads/:leadId/activity', async (req, res, next) => {
  try {
    const lead = await Lead.getLead(req.params.leadId);
    if (!lead || lead.organization_id !== req.workspaceOrganization.id) return res.status(404).json({ error: 'Not found' });
    const activity = await Lead.listActivity(lead.id, req.query);
    res.json({ activity: activity.map(publicActivity) });
  } catch (e) { next(e); }
});

// ── Routing rules ─────────────────────────────────────────────────────────────

// GET /api/platform/lead-routing-rules
router.get('/lead-routing-rules', requirePlatformAdminRole, async (req, res, next) => {
  try {
    const rules = await Lead.listRoutingRules(req.workspaceOrganization.id);
    res.json({ rules });
  } catch (e) { next(e); }
});

// POST /api/platform/lead-routing-rules
router.post('/lead-routing-rules', requirePlatformAdminRole, async (req, res, next) => {
  try {
    const { businessUnitId, fieldPath, fieldValue, priority } = req.body;
    if (!businessUnitId || !fieldPath || !fieldValue) {
      return res.status(400).json({ error: 'businessUnitId, fieldPath, and fieldValue are required' });
    }
    const buOk = await BusinessUnit.businessUnitBelongsToOrg(businessUnitId, req.workspaceOrganization.id);
    if (!buOk) return res.status(400).json({ error: 'Business unit not found' });
    const rule = await Lead.createRoutingRule(req.workspaceOrganization.id, {
      businessUnitId, fieldPath, fieldValue, priority, createdBy: req.user.id,
    });
    res.status(201).json({ rule });
  } catch (e) { next(e); }
});

// DELETE /api/platform/lead-routing-rules/:ruleId
router.delete('/lead-routing-rules/:ruleId', requirePlatformAdminRole, async (req, res, next) => {
  try {
    await Lead.deleteRoutingRule(req.params.ruleId);
    res.status(204).end();
  } catch (e) { next(e); }
});

export default router;
