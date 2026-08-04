import { Router } from 'express';
import * as BusinessUnit from '../../models/BusinessUnit.js';
import { requirePlatformAdminRole } from '../../middleware/auth.js';
import { resolveBasicTierBusinessUnitScope } from './shared.js';

const router = Router();

// D-014: this list/detail/members surface was readable by any authenticated
// workspace user regardless of tier, so a Basic-tier user (scoped to
// specific Business Units everywhere else -- Clients, Prospects, Contacts)
// could see every Business Unit's name and staff roster here, including
// ones outside their assigned tags. Basic tier is now scoped to the same
// user_business_units tags used everywhere else, matched by name -- the
// mechanism this codebase already uses to tie the two systems together
// (see migration 068's comment on user_business_units).
async function basicTierAllowedBuNames(user) {
  const scope = await resolveBasicTierBusinessUnitScope(user);
  return scope === null ? null : new Set(scope);
}

function publicBu(row) {
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    code: row.code,
    description: row.description,
    isActive: row.is_active,
    settings: row.settings || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function publicMember(row) {
  return {
    userId: row.user_id,
    buRole: row.bu_role,
    email: row.email,
    firstName: row.first_name,
    lastName: row.last_name,
    orgRole: row.org_role,
    joinedAt: row.created_at,
  };
}

// GET /api/platform/business-units
router.get('/', async (req, res, next) => {
  try {
    const orgId = req.workspaceOrganization.id;
    const includeInactive = req.query.includeInactive === 'true';
    let units = await BusinessUnit.listBusinessUnits(orgId, { includeInactive });
    const allowedNames = await basicTierAllowedBuNames(req.user);
    if (allowedNames !== null) {
      units = units.filter((u) => allowedNames.has(u.name));
    }
    res.json({ businessUnits: units.map(publicBu) });
  } catch (e) { next(e); }
});

// POST /api/platform/business-units  (admin only)
router.post('/', requirePlatformAdminRole, async (req, res, next) => {
  try {
    const { name, code, description, settings } = req.body;
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'name is required' });
    const bu = await BusinessUnit.createBusinessUnit(req.workspaceOrganization.id, {
      name, code, description, settings, createdBy: req.user.id,
    });
    res.status(201).json({ businessUnit: publicBu(bu) });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'A business unit with that name or code already exists' });
    next(e);
  }
});

// GET /api/platform/business-units/:buId
router.get('/:buId', async (req, res, next) => {
  try {
    const bu = await BusinessUnit.getBusinessUnit(req.params.buId);
    if (!bu || bu.organization_id !== req.workspaceOrganization.id) return res.status(404).json({ error: 'Not found' });
    const allowedNames = await basicTierAllowedBuNames(req.user);
    if (allowedNames !== null && !allowedNames.has(bu.name)) return res.status(404).json({ error: 'Not found' });
    res.json({ businessUnit: publicBu(bu) });
  } catch (e) { next(e); }
});

// PATCH /api/platform/business-units/:buId  (admin only)
router.patch('/:buId', requirePlatformAdminRole, async (req, res, next) => {
  try {
    const bu = await BusinessUnit.getBusinessUnit(req.params.buId);
    if (!bu || bu.organization_id !== req.workspaceOrganization.id) return res.status(404).json({ error: 'Not found' });
    const updated = await BusinessUnit.updateBusinessUnit(req.params.buId, req.body);
    res.json({ businessUnit: publicBu(updated) });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'A business unit with that name or code already exists' });
    next(e);
  }
});

// DELETE /api/platform/business-units/:buId  (admin only)
router.delete('/:buId', requirePlatformAdminRole, async (req, res, next) => {
  try {
    const bu = await BusinessUnit.getBusinessUnit(req.params.buId);
    if (!bu || bu.organization_id !== req.workspaceOrganization.id) return res.status(404).json({ error: 'Not found' });
    await BusinessUnit.deleteBusinessUnit(req.params.buId);
    res.status(204).end();
  } catch (e) { next(e); }
});

// ── Members ───────────────────────────────────────────────────────────────────

// GET /api/platform/business-units/:buId/members
router.get('/:buId/members', async (req, res, next) => {
  try {
    const bu = await BusinessUnit.getBusinessUnit(req.params.buId);
    if (!bu || bu.organization_id !== req.workspaceOrganization.id) return res.status(404).json({ error: 'Not found' });
    const allowedNames = await basicTierAllowedBuNames(req.user);
    if (allowedNames !== null && !allowedNames.has(bu.name)) return res.status(404).json({ error: 'Not found' });
    const members = await BusinessUnit.listMembers(req.params.buId);
    res.json({ members: members.map(publicMember) });
  } catch (e) { next(e); }
});

// PUT /api/platform/business-units/:buId/members/:userId  (admin only)
router.put('/:buId/members/:userId', requirePlatformAdminRole, async (req, res, next) => {
  try {
    const bu = await BusinessUnit.getBusinessUnit(req.params.buId);
    if (!bu || bu.organization_id !== req.workspaceOrganization.id) return res.status(404).json({ error: 'Not found' });
    const { buRole } = req.body;
    if (buRole && !BusinessUnit.BU_ROLES.includes(buRole)) {
      return res.status(400).json({ error: `buRole must be one of: ${BusinessUnit.BU_ROLES.join(', ')}` });
    }
    const member = await BusinessUnit.addMember(req.params.buId, req.params.userId, buRole);
    res.json({ member: publicMember({ ...member, email: null, first_name: null, last_name: null, org_role: null }) });
  } catch (e) { next(e); }
});

// DELETE /api/platform/business-units/:buId/members/:userId  (admin only)
router.delete('/:buId/members/:userId', requirePlatformAdminRole, async (req, res, next) => {
  try {
    const bu = await BusinessUnit.getBusinessUnit(req.params.buId);
    if (!bu || bu.organization_id !== req.workspaceOrganization.id) return res.status(404).json({ error: 'Not found' });
    await BusinessUnit.removeMember(req.params.buId, req.params.userId);
    res.status(204).end();
  } catch (e) { next(e); }
});

export default router;
