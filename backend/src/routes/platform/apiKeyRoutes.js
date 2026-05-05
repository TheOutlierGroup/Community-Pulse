import * as LicenseeApiKey from '../../models/LicenseeApiKey.js';
import * as Organization from '../../models/Organization.js';
import { auditFromRequest, AUDIT_ACTIONS } from '../../services/auditLog.js';

/**
 * SEC-03 mint/list/revoke endpoints for licensee API keys.
 *
 * Authorisation rules:
 *   - platform admins may manage keys for any licensee
 *   - licensee admins may manage keys for their own org only
 *   - everyone else is denied
 */

function canManageKeys(req, targetOrg) {
  if (!req.user || !targetOrg || targetOrg.kind !== 'licensee') return false;
  if (req.user.role !== 'admin') return false;
  if (req.workspaceOrganization?.kind === 'platform') return true;
  if (req.workspaceOrganization?.kind === 'licensee') {
    return req.workspaceOrganization.id === targetOrg.id;
  }
  return false;
}

export function registerApiKeyRoutes(router) {
  router.get('/organizations/:id/api-keys', async (req, res, next) => {
    try {
      const org = await Organization.getOrganization(req.params.id);
      if (!canManageKeys(req, org)) return res.status(403).json({ error: 'Not allowed' });
      const includeRevoked = String(req.query?.includeRevoked || 'true').toLowerCase() !== 'false';
      const rows = await LicenseeApiKey.listForOrganization(org.id, { includeRevoked });
      res.json({ apiKeys: rows.map(LicenseeApiKey.publicRow) });
    } catch (error) {
      next(error);
    }
  });

  router.post('/organizations/:id/api-keys', async (req, res, next) => {
    try {
      const org = await Organization.getOrganization(req.params.id);
      if (!canManageKeys(req, org)) return res.status(403).json({ error: 'Not allowed' });
      const name = String(req.body?.name || '').trim().slice(0, 100);
      if (!name) return res.status(400).json({ error: 'name is required' });
      const { row, plaintext } = await LicenseeApiKey.createKey({
        organizationId: org.id,
        name,
        createdBy: req.user?.id || null,
      });
      auditFromRequest(req)({
        action: AUDIT_ACTIONS.API_KEY_CREATE,
        targetType: 'api_key',
        targetId: row.id,
        targetOrganizationId: org.id,
        metadata: { name, prefix: row.prefix },
      });
      // The plaintext is returned EXACTLY ONCE. If the client loses it,
      // the only remediation is revoke + mint a new key.
      res.status(201).json({
        apiKey: LicenseeApiKey.publicRow(row),
        plaintext,
        warning: 'This token is shown only once. Copy it now and store it in your secret manager.',
      });
    } catch (error) {
      next(error);
    }
  });

  router.delete('/organizations/:id/api-keys/:keyId', async (req, res, next) => {
    try {
      const org = await Organization.getOrganization(req.params.id);
      if (!canManageKeys(req, org)) return res.status(403).json({ error: 'Not allowed' });
      const row = await LicenseeApiKey.revokeKey(req.params.keyId, org.id);
      if (!row) return res.status(404).json({ error: 'API key not found' });
      auditFromRequest(req)({
        action: AUDIT_ACTIONS.API_KEY_REVOKE,
        targetType: 'api_key',
        targetId: row.id,
        targetOrganizationId: org.id,
        metadata: { name: row.name, prefix: row.prefix },
      });
      res.json({ apiKey: LicenseeApiKey.publicRow(row) });
    } catch (error) {
      next(error);
    }
  });
}
