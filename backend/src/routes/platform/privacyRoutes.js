import { Router } from 'express';
import { query } from '../../config/database.js';
import { requireBodyFields } from '../../middleware/validation.js';
import * as PrivacyRequest from '../../models/PrivacyRequest.js';
import { assertClientOrganizationPlatformForUser } from './shared.js';
import { logAuditEvent, listRecentAuditEvents } from '../../services/auditLog.js';
import {
  completeDeletionRequest,
  createDeletionRequest,
  runManualDeletion,
} from '../../services/privacyDeletion.js';
import { anonymizeClosedProjectIdentifiers } from '../../services/retentionPolicy.js';

const router = Router();

function requirePlatformAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin only' });
  }
  return next();
}

async function safeLogAudit(event) {
  try {
    await logAuditEvent(event);
  } catch (error) {
    // Never fail the main privacy operation due to audit sink issues.
    console.error('privacy audit log failed:', error);
  }
}

function handleDbError(error, res, next) {
  if (!error?.code) return next(error);
  if (error.code === '22P02') return res.status(400).json({ error: 'Invalid identifier format' });
  if (error.code === '23503') return res.status(404).json({ error: 'Related record not found' });
  if (error.code === '42P01') {
    return res.status(503).json({ error: 'Privacy storage is not initialized. Run migrations.' });
  }
  return next(error);
}

router.get('/privacy/audit-events', async (req, res, next) => {
  try {
    const events = await listRecentAuditEvents({
      organizationId: req.query.organizationId || null,
      action: req.query.action || null,
      limit: Number.parseInt(String(req.query.limit || '100'), 10),
      offset: Number.parseInt(String(req.query.offset || '0'), 10),
    });
    res.json({ events });
  } catch (error) {
    next(error);
  }
});

router.get('/privacy/requests', async (req, res, next) => {
  try {
    const organizationId = String(req.query.organizationId || '').trim();
    if (!organizationId) {
      return res.status(400).json({ error: 'organizationId is required' });
    }
    const org = await assertClientOrganizationPlatformForUser(organizationId, req.user);
    if (!org) return res.status(404).json({ error: 'Organization not found' });
    const requests = await PrivacyRequest.listPrivacyRequestsForOrg(req.query.organizationId, {
      status: req.query.status || null,
      limit: Number.parseInt(String(req.query.limit || '200'), 10),
      offset: Number.parseInt(String(req.query.offset || '0'), 10),
    });
    res.json({ requests });
  } catch (error) {
    next(error);
  }
});

router.post(
  '/privacy/requests',
  requireBodyFields(['organizationId', 'requestType', 'subjectEmail']),
  async (req, res, next) => {
    try {
      const org = await assertClientOrganizationPlatformForUser(req.body.organizationId, req.user);
      if (!org) return res.status(404).json({ error: 'Organization not found' });
      const request = await PrivacyRequest.createPrivacyRequest({
        organizationId: org.id,
        requestType: req.body.requestType,
        subjectEmail: req.body.subjectEmail,
        subjectName: req.body.subjectName || null,
        requestDetails: req.body.requestDetails || null,
        createdByUserId: req.user.id,
        metadata: {
          respondentCountryCode: req.body.respondentCountryCode || null,
          privacyNoticeVersion: req.body.privacyNoticeVersion || null,
        },
      });
      await safeLogAudit({
        actor: req.user,
        action: 'privacy.request.created',
        targetType: 'privacy_request',
        targetId: request.id,
        targetOrganizationId: request.organization_id,
        result: 'ok',
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
        metadata: {
          requestType: request.request_type,
          dueAt: request.due_at,
        },
      });
      if (request.request_type === 'deletion' && req.body.triggerImmediatePurge === true) {
        const purge = await anonymizeClosedProjectIdentifiers({ dryRun: false });
        await safeLogAudit({
          actor: req.user,
          action: 'privacy.request.immediate_purge',
          targetType: 'organization',
          targetId: request.organization_id,
          targetOrganizationId: request.organization_id,
          result: 'ok',
          ipAddress: req.ip,
          userAgent: req.get('user-agent'),
          metadata: {
            requestId: request.id,
            recordsAnonymized: purge.recordsAnonymized,
          },
        });
      }
      res.status(201).json({ request });
    } catch (error) {
      handleDbError(error, res, next);
    }
  }
);

router.patch('/privacy/requests/:id', requireBodyFields(['organizationId']), async (req, res, next) => {
  try {
    const org = await assertClientOrganizationPlatformForUser(req.body.organizationId, req.user);
    if (!org) return res.status(404).json({ error: 'Organization not found' });
    const request = await PrivacyRequest.updatePrivacyRequest(
      req.params.id,
      org.id,
      {
        status: req.body.status,
        identityVerified: req.body.identityVerified,
        requestDetails: req.body.requestDetails,
        metadata: req.body.metadata,
      },
      req.user.id
    );
    if (!request) return res.status(404).json({ error: 'Request not found' });
    await safeLogAudit({
      actor: req.user,
      action: 'privacy.request.updated',
      targetType: 'privacy_request',
      targetId: request.id,
      targetOrganizationId: request.organization_id,
      result: 'ok',
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
      metadata: { status: request.status, identityVerified: request.identity_verified },
    });
    res.json({ request });
  } catch (error) {
    handleDbError(error, res, next);
  }
});

router.post(
  '/privacy/permanent-delete',
  requirePlatformAdmin,
  requireBodyFields(['organizationId', 'targetType', 'targetId', 'reason', 'confirmation']),
  async (req, res, next) => {
    try {
      const org = await assertClientOrganizationPlatformForUser(req.body.organizationId, req.user);
      if (!org) return res.status(404).json({ error: 'Organization not found' });
      if (req.body.confirmation !== 'PERMANENT_DELETE') {
        return res.status(400).json({ error: 'confirmation must be PERMANENT_DELETE' });
      }
      const deletionRequest = await createDeletionRequest({
        organizationId: org.id,
        requestedByUserId: req.user.id,
        reason: req.body.reason,
        targetType: req.body.targetType,
        targetId: req.body.targetId,
      });
      const result = await runManualDeletion({
        organizationId: org.id,
        targetType: req.body.targetType,
        targetId: req.body.targetId,
        legalHold: Boolean(req.body.legalHold),
      });
      const completed = await completeDeletionRequest(deletionRequest.id, {
        status: result.status,
        summary: result.summary,
      });
      await safeLogAudit({
        actor: req.user,
        action: 'privacy.permanent_delete',
        targetType: req.body.targetType,
        targetId: req.body.targetId,
        targetOrganizationId: org.id,
        result: result.status,
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
        metadata: {
          reason: req.body.reason,
          rowsChanged: result.rowsChanged,
          requestId: deletionRequest.id,
        },
      });
      res.json({ deletionRequest: completed, result });
    } catch (error) {
      handleDbError(error, res, next);
    }
  }
);

router.post(
  '/privacy/archive/mark',
  requirePlatformAdmin,
  requireBodyFields(['organizationId']),
  async (req, res, next) => {
    try {
      const org = await assertClientOrganizationPlatformForUser(req.body.organizationId, req.user);
      if (!org) return res.status(404).json({ error: 'Organization not found' });
      const dueYears = Number.parseInt(String(process.env.TIER3_DISPOSAL_YEARS || '7'), 10);
      const disposalYears = Number.isFinite(dueYears) && dueYears > 0 ? dueYears : 7;
      const { rows } = await query(
        `UPDATE organizations
         SET archived_at = COALESCE(archived_at, NOW()),
             tier3_archive_at = COALESCE(tier3_archive_at, NOW()),
             tier3_disposal_due_at = COALESCE(
               tier3_disposal_due_at,
               NOW() + make_interval(years => $2::int)
             )
         WHERE id = $1
         RETURNING id, archived_at, tier3_archive_at, tier3_disposal_due_at`,
        [org.id, disposalYears]
      );
      if (!rows[0]) return res.status(404).json({ error: 'Organization not found' });
      await safeLogAudit({
        actor: req.user,
        action: 'privacy.archive.marked',
        targetType: 'organization',
        targetId: rows[0].id,
        targetOrganizationId: rows[0].id,
        result: 'ok',
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
      });
      res.json({ archive: rows[0] });
    } catch (error) {
      handleDbError(error, res, next);
    }
  }
);

router.get('/privacy/archive/review-report', requirePlatformAdmin, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, name, archived_at, tier3_archive_at, tier3_disposal_due_at
       FROM organizations
       WHERE archived_at IS NOT NULL
       ORDER BY tier3_disposal_due_at ASC NULLS LAST, archived_at ASC`
    );
    const now = Date.now();
    const report = rows.map((row) => {
      const dueMs = row.tier3_disposal_due_at ? new Date(row.tier3_disposal_due_at).getTime() : null;
      const daysToDisposal = Number.isFinite(dueMs) ? Math.floor((dueMs - now) / (24 * 60 * 60 * 1000)) : null;
      return {
        ...row,
        daysToDisposal,
        disposalWindow: daysToDisposal != null && daysToDisposal <= 90 ? 'due_soon' : 'normal',
      };
    });
    res.json({ generatedAt: new Date().toISOString(), report });
  } catch (error) {
    next(error);
  }
});

export default router;
