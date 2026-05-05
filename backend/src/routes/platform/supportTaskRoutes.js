import { Router } from 'express';
import { supportTaskLimiter } from '../../middleware/sensitiveRateLimit.js';
import * as ClientWorkTask from '../../models/ClientWorkTask.js';
import * as Organization from '../../models/Organization.js';
import { auditFromRequest, AUDIT_ACTIONS } from '../../services/auditLog.js';

const router = Router();

const CATEGORY_LABEL = {
  general: 'support',
  billing: 'support:billing',
  technical: 'support:technical',
  bug: 'support:bug',
};
const SUBJECT_MAX = 200;
const BODY_MAX = 5000;

/**
 * SUP-02: a licensee admin/employee submits a support request from
 * the in-app "Contact support" widget. We create a card on that
 * licensee's CRM task board (the same board platform staff already
 * use to manage their work for that account) and tag it with a
 * `support*` label so it's filterable.
 *
 * No new table, no new admin inbox: platform admins see and triage
 * support requests right alongside any other work for that licensee.
 *
 * Mounted *before* requirePlatformOnlyUser so licensee users can
 * reach it. The route ignores requesters whose own org is not a
 * licensee (platform users have other channels).
 */
router.post('/me/support-task', supportTaskLimiter, async (req, res, next) => {
  try {
    const subjectRaw = String(req.body?.subject || '').trim();
    const bodyRaw = String(req.body?.body || '').trim();
    const categoryRaw = String(req.body?.category || 'general').trim().toLowerCase();
    if (!subjectRaw) return res.status(400).json({ error: 'subject is required' });
    if (!bodyRaw) return res.status(400).json({ error: 'body is required' });

    const subject = subjectRaw.slice(0, SUBJECT_MAX);
    const body = bodyRaw.slice(0, BODY_MAX);
    const category = CATEGORY_LABEL[categoryRaw] ? categoryRaw : 'general';

    const org = await Organization.getOrganization(req.user.organizationId);
    if (!org) return res.status(404).json({ error: 'Organization not found' });
    if (org.kind !== 'licensee') {
      return res.status(403).json({
        error: 'Support requests are only accepted from licensee workspaces',
      });
    }

    const requesterEmail = req.user?.email || '';
    const taskBody = [
      body,
      '',
      `— Submitted by ${requesterEmail || 'a licensee user'} via in-app support widget`,
    ].join('\n');

    const created = await ClientWorkTask.createTask(
      org.id,
      {
        title: `Support: ${subject}`,
        body: taskBody,
        status: 'todo',
      },
      req.user.id
    );
    if (!created) {
      return res.status(500).json({ error: 'Failed to create support task' });
    }

    await ClientWorkTask.replaceTaskCardLabels(created.id, org.id, [CATEGORY_LABEL[category]]);

    auditFromRequest(req)({
      action: AUDIT_ACTIONS.SUPPORT_TASK_CREATE,
      targetType: 'client_work_task',
      targetId: created.id,
      targetOrganizationId: org.id,
      metadata: { subject, category },
    });

    res.status(201).json({
      task: {
        id: created.id,
        title: created.title,
        status: created.status,
        organizationId: org.id,
      },
    });
  } catch (error) {
    next(error);
  }
});

export default router;
