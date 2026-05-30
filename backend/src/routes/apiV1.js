import { Router } from 'express';
import { requireApiKey } from '../middleware/apiKey.js';
import { getLicenseeHealthForOrg } from '../services/licenseeHealth.js';
import { buildLicenseeDataExport } from '../services/licenseeDataExport.js';
import { dataExportLimiter } from '../middleware/sensitiveRateLimit.js';
import apiV1LeadRoutes from './apiV1Leads.js';

/**
 * SEC-03 public read-only API surface for licensees, authenticated via
 * the `rk_*` API keys minted under /api/platform/organizations/:id/api-keys.
 *
 * Intentionally tiny in v1 — exposes only what licensees genuinely need
 * for programmatic access:
 *   - GET /api/v1/me                — returns the licensee org id + name
 *   - GET /api/v1/me/health         — operational snapshot (same as the
 *                                     internal admin panel)
 *   - GET /api/v1/me/data-export    — full portability bundle
 *
 * Mutations are deliberately NOT exposed yet — the surface area for
 * programmatic writes (org creation, brand changes, etc.) is high-risk
 * and we can add per-scope tokens later if/when needed.
 */
const router = Router();

router.get('/me', requireApiKey, async (req, res) => {
  res.json({
    organization: {
      id: req.licenseeOrganization.id,
      name: req.licenseeOrganization.name,
      kind: req.licenseeOrganization.kind,
    },
    apiKey: { id: req.apiKey.id, prefix: req.apiKey.prefix, name: req.apiKey.name },
  });
});

router.get('/me/health', requireApiKey, async (req, res, next) => {
  try {
    const snapshot = await getLicenseeHealthForOrg(req.licenseeOrganization.id);
    res.json({ licensee: snapshot });
  } catch (error) {
    next(error);
  }
});

router.get('/me/data-export', requireApiKey, dataExportLimiter, async (req, res, next) => {
  try {
    const bundle = await buildLicenseeDataExport(req.licenseeOrganization.id);
    if (!bundle) return res.status(404).json({ error: 'Licensee not found' });
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'private, no-cache');
    res.status(200).send(JSON.stringify(bundle, null, 2));
  } catch (error) {
    next(error);
  }
});

// Lead ingestion — POST /api/v1/leads/ingest
router.use(apiV1LeadRoutes);

export default router;
