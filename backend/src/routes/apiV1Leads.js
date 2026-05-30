import { Router } from 'express';
import { requireApiKey } from '../middleware/apiKey.js';
import * as Lead from '../models/Lead.js';
import * as Account from '../models/Account.js';
import * as BusinessUnit from '../models/BusinessUnit.js';
import * as PipelineStage from '../models/PipelineStage.js';
import { resolveLeadDestination } from '../services/leadRoutingEngine.js';

/**
 * POST /api/v1/leads/ingest
 *
 * Omnichannel lead ingestion endpoint for external forms and webhooks.
 * Authenticated via licensee API key (rk_*).
 *
 * Routing: evaluates lead_routing_rules against sourceMetadata to auto-assign
 * the lead to a BU + first pipeline stage. If no rule matches, the caller
 * must supply businessUnitId explicitly; pipelineStageId is then the first
 * stage of that BU unless also provided.
 *
 * Body:
 *   title           string  required
 *   accountName     string  required (creates a new account if no accountId)
 *   accountId       uuid    optional – use existing account
 *   contactFirstName string required (creates new contact if no contactId)
 *   contactLastName  string required
 *   contactEmail    string  optional
 *   contactId       uuid    optional – use existing contact
 *   businessUnitId  uuid    optional – required if routing rules produce no match
 *   pipelineStageId uuid    optional – defaults to first stage of resolved BU
 *   source          string  optional
 *   sourceMetadata  object  optional – payload evaluated by routing engine
 *   description     string  optional
 *   assignedTo      uuid    optional
 *   customFields    object  optional
 */
const router = Router();

router.post('/leads/ingest', requireApiKey, async (req, res, next) => {
  try {
    const orgId = req.licenseeOrganization.id;
    const {
      title, accountId, accountName, contactId, contactFirstName, contactLastName, contactEmail,
      businessUnitId: explicitBuId, pipelineStageId: explicitStageId,
      source, sourceMetadata = {}, description, assignedTo, customFields,
    } = req.body;

    if (!title || !String(title).trim()) {
      return res.status(400).json({ error: 'title is required' });
    }

    // ── Resolve BU + stage via routing engine ─────────────────────────────────
    let resolvedBuId = explicitBuId || null;
    let resolvedStageId = explicitStageId || null;

    const routed = await resolveLeadDestination(orgId, sourceMetadata);
    if (routed) {
      resolvedBuId = routed.businessUnitId;
      resolvedStageId = routed.pipelineStageId;
    }

    if (!resolvedBuId) {
      return res.status(400).json({ error: 'Could not determine business unit. Supply businessUnitId or configure routing rules.' });
    }

    // Verify BU belongs to this org
    const buOk = await BusinessUnit.businessUnitBelongsToOrg(resolvedBuId, orgId);
    if (!buOk) return res.status(400).json({ error: 'Business unit not found' });

    // If no stage resolved yet, take the first stage for this BU
    if (!resolvedStageId) {
      const firstStage = await PipelineStage.getFirstStageForBu(resolvedBuId);
      if (!firstStage) return res.status(400).json({ error: 'No pipeline stages configured for this business unit' });
      resolvedStageId = firstStage.id;
    }

    // ── Resolve / create Account ──────────────────────────────────────────────
    let resolvedAccountId = accountId || null;
    if (!resolvedAccountId) {
      if (!accountName || !String(accountName).trim()) {
        return res.status(400).json({ error: 'accountName is required when accountId is not provided' });
      }
      const account = await Account.createAccount(orgId, {
        name: accountName, source: source || 'ingest',
      });
      resolvedAccountId = account.id;
    } else {
      const acctOk = await Account.accountBelongsToOrg(resolvedAccountId, orgId);
      if (!acctOk) return res.status(400).json({ error: 'Account not found' });
    }

    // ── Resolve / create Contact ──────────────────────────────────────────────
    let resolvedContactId = contactId || null;
    if (!resolvedContactId) {
      if (!contactFirstName || !contactLastName) {
        return res.status(400).json({ error: 'contactFirstName and contactLastName are required when contactId is not provided' });
      }
      const contact = await Account.createContact(resolvedAccountId, {
        firstName: contactFirstName, lastName: contactLastName, email: contactEmail || null,
      });
      resolvedContactId = contact.id;
    }

    // ── Create the lead ───────────────────────────────────────────────────────
    const lead = await Lead.createLead(orgId, {
      businessUnitId: resolvedBuId,
      accountId: resolvedAccountId,
      contactId: resolvedContactId,
      pipelineStageId: resolvedStageId,
      title, description, source: source || 'api_ingest', sourceMetadata,
      assignedTo, customFields,
    });

    await Lead.logActivity(lead.id, null, Lead.LEAD_ACTIVITY_TYPES.CREATED, {
      title: lead.title, source: lead.source, via: 'api_v1_ingest',
    });

    res.status(201).json({ lead: { id: lead.id, title: lead.title, businessUnitId: resolvedBuId, pipelineStageId: resolvedStageId } });
  } catch (e) {
    next(e);
  }
});

export default router;
