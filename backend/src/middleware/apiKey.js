import * as LicenseeApiKey from '../models/LicenseeApiKey.js';
import * as Organization from '../models/Organization.js';

/**
 * SEC-03 API key auth middleware. Use INSTEAD of requireAuth on the
 * read-only programmatic surfaces. On success populates `req.apiKey`
 * and `req.user` with a synthetic system user that's read-only by
 * convention (no role -> requireAdmin will block writes).
 *
 * Looks for a Bearer token shaped `rk_*`. Falls through to the next
 * middleware if no Authorization header is present so callers can
 * compose with requireAuth as a fallback.
 */
export async function requireApiKey(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token.startsWith('rk_')) {
      return res.status(401).json({ error: 'API key required' });
    }
    const row = await LicenseeApiKey.findActiveKeyByPlaintext(token);
    if (!row) {
      return res.status(401).json({ error: 'Invalid or revoked API key' });
    }
    const org = await Organization.getOrganization(row.organization_id);
    if (!org || org.kind !== 'licensee') {
      return res.status(401).json({ error: 'API key is no longer associated with an active licensee' });
    }
    req.apiKey = row;
    req.workspaceOrganization = org;
    req.licenseeOrganization = org;
    req.user = {
      id: `apikey:${row.id}`,
      role: 'apikey',
      organizationId: org.id,
      organizationKind: 'licensee',
      apiKeyId: row.id,
    };
    next();
  } catch (e) {
    next(e);
  }
}
