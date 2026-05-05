import { Router } from 'express';
import { requirePlatformAdminRole } from '../../middleware/auth.js';
import * as PlatformAnnouncement from '../../models/PlatformAnnouncement.js';
import * as Organization from '../../models/Organization.js';
import * as User from '../../models/User.js';
import { auditFromRequest, AUDIT_ACTIONS } from '../../services/auditLog.js';
import { sendPlatformAnnouncementEmail, isResendConfigured } from '../../services/email.js';

const router = Router();

function requirePlatformOrg(req, res) {
  if (req.workspaceOrganization?.kind !== 'platform') {
    res.status(403).json({ error: 'Only platform admins can manage announcements' });
    return false;
  }
  return true;
}

/**
 * COM-02 in-app feed used by the AnnouncementBanner. Returns banner-
 * eligible, non-expired announcements for the requester's audience.
 * Available to any workspace user — gating is by audience, not role.
 */
router.get('/announcements/active', async (req, res, next) => {
  try {
    const audience = req.workspaceOrganization?.kind === 'platform' ? 'platform' : 'licensee';
    const rows = await PlatformAnnouncement.listActiveForAudience(audience);
    res.json({ announcements: rows.map(PlatformAnnouncement.publicAnnouncement) });
  } catch (e) {
    next(e);
  }
});

router.get('/announcements', requirePlatformAdminRole, async (req, res, next) => {
  if (!requirePlatformOrg(req, res)) return;
  try {
    const rows = await PlatformAnnouncement.listForAdmin({
      limit: Number.parseInt(req.query?.limit, 10) || 100,
    });
    res.json({ announcements: rows.map(PlatformAnnouncement.publicAnnouncement) });
  } catch (e) {
    next(e);
  }
});

router.post('/announcements', requirePlatformAdminRole, async (req, res, next) => {
  if (!requirePlatformOrg(req, res)) return;
  try {
    const { title, body, audience, banner, emailOnPublish, expiresAt } = req.body || {};
    if (!title || !body) return res.status(400).json({ error: 'title and body are required' });
    const row = await PlatformAnnouncement.createAnnouncement({
      title,
      body,
      audience: audience || 'all',
      banner: banner !== false,
      emailOnPublish: Boolean(emailOnPublish),
      expiresAt,
      createdBy: req.user.id,
    });
    auditFromRequest(req)({
      action: AUDIT_ACTIONS.ANNOUNCEMENT_CREATE,
      targetType: 'announcement',
      targetId: row.id,
      metadata: { title: row.title, audience: row.audience, banner: row.banner, emailOnPublish: row.email_on_publish },
    });
    // COM-05: if the admin asked for an email broadcast, fire it now in
    // the background. We deliberately don't block the response; the
    // admin sees the announcement appear, and the email count will
    // populate once the broadcast finishes.
    if (row.email_on_publish) {
      void broadcastAnnouncementEmail(row, req).catch((err) => {
        console.error('Announcement broadcast failed:', err);
      });
    }
    res.status(201).json({ announcement: PlatformAnnouncement.publicAnnouncement(row) });
  } catch (e) {
    next(e);
  }
});

router.patch('/announcements/:id', requirePlatformAdminRole, async (req, res, next) => {
  if (!requirePlatformOrg(req, res)) return;
  try {
    const updated = await PlatformAnnouncement.updateAnnouncement(req.params.id, req.body || {});
    if (!updated) return res.status(404).json({ error: 'Announcement not found' });
    auditFromRequest(req)({
      action: AUDIT_ACTIONS.ANNOUNCEMENT_UPDATE,
      targetType: 'announcement',
      targetId: updated.id,
    });
    res.json({ announcement: PlatformAnnouncement.publicAnnouncement(updated) });
  } catch (e) {
    next(e);
  }
});

router.delete('/announcements/:id', requirePlatformAdminRole, async (req, res, next) => {
  if (!requirePlatformOrg(req, res)) return;
  try {
    const deleted = await PlatformAnnouncement.deleteAnnouncement(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Announcement not found' });
    auditFromRequest(req)({
      action: AUDIT_ACTIONS.ANNOUNCEMENT_DELETE,
      targetType: 'announcement',
      targetId: deleted.id,
    });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// COM-05: manual re-broadcast (e.g. you forgot to tick the checkbox at
// create time, or you want to ping admins of newly-onboarded
// licensees). The announcement remembers its email_sent_at so a second
// /broadcast call is a no-op unless `force=true` is passed.
router.post('/announcements/:id/broadcast', requirePlatformAdminRole, async (req, res, next) => {
  if (!requirePlatformOrg(req, res)) return;
  try {
    const announcement = await PlatformAnnouncement.getById(req.params.id);
    if (!announcement) return res.status(404).json({ error: 'Announcement not found' });
    if (announcement.email_sent_at && !req.body?.force) {
      return res.status(409).json({
        error: 'Already broadcast. Send `{ "force": true }` to send again.',
        emailSentAt: announcement.email_sent_at,
      });
    }
    const result = await broadcastAnnouncementEmail(announcement, req, { force: Boolean(req.body?.force) });
    res.json(result);
  } catch (e) {
    next(e);
  }
});

/**
 * Internal helper used by both create-with-email and manual broadcast.
 * Looks up active admin recipients across the configured audience and
 * sends them the announcement. Returns { sent, failed, recipients }.
 */
async function broadcastAnnouncementEmail(announcement, req, { force = false } = {}) {
  if (!isResendConfigured()) {
    throw new Error('Resend is not configured for email broadcasts.');
  }
  const audience = announcement.audience;
  // Pick admin emails per audience kind. Platform-only announcements
  // still go to platform admins because they're often about
  // internal-tooling changes.
  const targetOrgs = [];
  if (audience === 'all' || audience === 'licensee') {
    targetOrgs.push(...await Organization.listOrganizationsByKind('licensee', { limit: 1000 }));
  }
  if (audience === 'all' || audience === 'platform') {
    targetOrgs.push(...await Organization.listOrganizationsByKind('platform', { limit: 200 }));
  }
  const recipients = [];
  for (const org of targetOrgs) {
    // eslint-disable-next-line no-await-in-loop
    const admins = await User.listUsersForOrg(org.id, { role: 'admin' });
    for (const a of admins) {
      if (!a || a.deactivated_at || a.login_enabled === false) continue;
      // COM-03: honour the per-user opt-out toggle.
      if (a.notification_preferences && a.notification_preferences.announcementOptOut === true) continue;
      recipients.push({ email: a.email, name: a.first_name || a.email, organizationName: org.name });
    }
  }
  let sent = 0;
  let failed = 0;
  for (const r of recipients) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await sendPlatformAnnouncementEmail({
        to: r.email,
        recipientName: r.name,
        organizationName: r.organizationName,
        title: announcement.title,
        body: announcement.body,
      });
      sent += 1;
    } catch (err) {
      failed += 1;
      console.error(`Announcement email to ${r.email} failed:`, err);
    }
  }
  if (sent > 0 && !force) {
    await PlatformAnnouncement.markEmailSent(announcement.id, sent);
  }
  if (req && req.user) {
    auditFromRequest(req)({
      action: AUDIT_ACTIONS.ANNOUNCEMENT_UPDATE,
      targetType: 'announcement',
      targetId: announcement.id,
      metadata: { broadcastSent: sent, broadcastFailed: failed, force },
    });
  }
  return { sent, failed, recipients: recipients.length, force };
}

export default router;
