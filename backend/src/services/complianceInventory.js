import { getStorageRoot } from '../config/storage.js';
import { getRetentionPolicy } from './retentionPolicy.js';

function boolEnv(name) {
  const value = process.env[name];
  if (value == null) return null;
  return String(value).toLowerCase() === 'true';
}

function detectStorageType(rootPath) {
  if (rootPath.startsWith('/var/')) return 'server_disk_mount';
  if (rootPath.startsWith('/Users/')) return 'local_filesystem';
  return 'filesystem_path';
}

export function buildComplianceInventory() {
  const storageRoot = getStorageRoot();
  const retentionPolicy = getRetentionPolicy();
  const appSurface = String(process.env.APP_SURFACE || 'all').toLowerCase();

  return {
    generatedAt: new Date().toISOString(),
    deployment: {
      appSurface,
      appUrl: process.env.APP_URL || null,
      crmAppUrl: process.env.CRM_APP_URL || null,
      pulseAppUrl: process.env.PULSE_APP_URL || null,
      frontendOrigin: process.env.FRONTEND_ORIGIN || null,
      storagePath: storageRoot,
      storageType: detectStorageType(storageRoot),
      databaseSsl: boolEnv('DATABASE_SSL'),
    },
    integrations: [
      {
        id: 'resend',
        category: 'email_delivery',
        configured: Boolean(process.env.RESEND_API_KEY),
      },
      {
        id: 'render',
        category: 'hosting',
        configured: boolEnv('RENDER') === true,
      },
      {
        id: 'google_fonts',
        category: 'frontend_asset',
        configured: true,
      },
    ],
    retentionPolicy: {
      exportRetentionDays: retentionPolicy.exportRetentionDays,
      tokenRetentionDays: retentionPolicy.tokenRetentionDays,
      projectCloseRetentionDays: retentionPolicy.projectCloseRetentionDays,
    },
    securityControls: {
      mfaEnforcedForAdmins: String(process.env.MFA_ENFORCE_ADMIN || 'true').toLowerCase() !== 'false',
      retentionAlertWebhookConfigured: Boolean(process.env.RETENTION_ALERT_WEBHOOK),
      clientDashboardTokenMaxHours: Number.parseInt(
        String(process.env.CLIENT_DASHBOARD_TOKEN_MAX_HOURS || '24'),
        10
      ),
    },
    unknowns: [
      'Physical cloud region must be confirmed in the hosting provider dashboard.',
      'Any offshore replication/backups are controlled by infrastructure provider settings, not app code.',
      'Processor sub-contractors must be confirmed through vendor legal documentation.',
    ],
  };
}
