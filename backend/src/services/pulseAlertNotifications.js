import * as InAppNotification from '../models/InAppNotification.js';
import { listPlatformAdminUsers } from '../models/User.js';

async function sendAlertsToAdmins({ clientOrgId, orgName, alerts }) {
  const admins = await listPlatformAdminUsers();
  if (!admins.length) return;

  for (const alert of alerts) {
    const alreadySent = await InAppNotification.hasSentRecentPulseAlert({
      organizationId: clientOrgId,
      title: alert.title,
    });
    if (alreadySent) continue;

    for (const admin of admins) {
      await InAppNotification.createNotification({
        userId: admin.id,
        organizationId: clientOrgId,
        type: InAppNotification.NOTIFICATION_TYPES.PULSE_ALERT,
        title: alert.title,
        body: orgName ? `[${orgName}] ${alert.body || ''}` : alert.body,
        metadata: { alertLevel: alert.level, orgName },
      });
    }
  }
}

export function schedulePulseAlertNotifications({ clientOrgId, orgName, alerts }) {
  void sendAlertsToAdmins({ clientOrgId, orgName, alerts }).catch((e) =>
    console.error('[schedulePulseAlertNotifications]', e)
  );
}
