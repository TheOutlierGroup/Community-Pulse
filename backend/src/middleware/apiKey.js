import * as LicenseeApiKey from '../models/LicenseeApiKey.js';
import * as Organization from '../models/Organization.js';

/**
 * SEC-03 API key auth middleware. Use INSTEAD of requireAuth on the
 * programmatic /api/v1 surface.
 *
 * PT-11: this previously described the surface as "read-only by
 * convention (no role -> requireAdmin will block writes)". Neither half
 * held. requireAdmin does not guard /api/v1 — requireApiKey is the only
 * gate on every route there — and the surface is not read-only:
 * POST /api/v1/leads/ingest is a write, by design.
 *
 * The actual model is an explicit route allowlist. /api/v1 is exactly
 * four routes (GET /me, GET /me/health, GET /me/data-export,
 * POST /leads/ingest), each naming requireApiKey directly, and all of
 * them scoped to the key's own licensee org. Nothing is inherited, so
 * adding a route to this surface is a deliberate act — which is the
 * property to preserve. Do not assume a role gate elsewhere is
 * constraining what a key can reach.
 *
 * `role: 'apikey'` is a deliberate non-role: it matches no branch in any
 * role gate in the codebase, so if one of these principals ever reaches
 * a human-facing admin route it is refused rather than defaulting into
 * some tier. See apiKey.roleGates.test.js, which pins that.
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
