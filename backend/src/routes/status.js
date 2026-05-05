import { Router } from 'express';
import * as PlatformStatusIncident from '../models/PlatformStatusIncident.js';

const router = Router();

/**
 * INF-08: public status feed. No auth — used by the /status page and
 * also polled by the in-app banner after login. The feed always returns
 * `activeIncidents` plus a small `recent` window so a status page can
 * show "Now operational" history without an extra round-trip.
 */
router.get('/', async (_req, res) => {
  try {
    const [active, recent] = await Promise.all([
      PlatformStatusIncident.listActiveIncidents(),
      PlatformStatusIncident.listIncidents({ limit: 20 }),
    ]);
    const overallStatus = active.length === 0 ? 'operational' : worstSeverity(active);
    res.json({
      overallStatus,
      activeIncidents: active.map(PlatformStatusIncident.publicIncident),
      recentIncidents: recent.map(PlatformStatusIncident.publicIncident),
    });
  } catch (error) {
    console.error('Failed to load public status feed:', error);
    res.status(500).json({ error: 'Could not load status' });
  }
});

function worstSeverity(incidents) {
  const order = { critical: 4, major: 3, minor: 2, maintenance: 1 };
  let worstName = 'maintenance';
  let worstScore = 0;
  for (const i of incidents) {
    const s = order[i.severity] || 0;
    if (s > worstScore) {
      worstScore = s;
      worstName = i.severity;
    }
  }
  return worstName;
}

export default router;
