import { Router } from 'express';
import { buildComplianceInventory } from '../../services/complianceInventory.js';

const router = Router();

router.get('/compliance/inventory', (req, res) => {
  const inventory = buildComplianceInventory();
  res.json({ inventory });
});

export default router;
