// Business-Unit-specific extra fields for CRM Prospects, stored in the
// generic crm_organisations.custom_fields JSONB column so future BUs can
// get their own field sets without a migration each time. Mirrored on the
// frontend in frontend/src/config/crmConstants.js — keep both in sync.
export const BUSINESS_UNIT_CUSTOM_FIELDS = {
  'Outlier Skate': [
    { key: 'state', label: 'State', type: 'text' },
    { key: 'town', label: 'Town', type: 'text' },
    { key: 'amountWon', label: 'Amount Won so far', type: 'number' },
    { key: 'nextAuditDate', label: 'Date of Next Audit', type: 'date' },
    { key: 'numSkateparks', label: 'Number of Skateparks', type: 'number' },
    { key: 'nextStrategyReviewDate', label: 'Date of Next Strategy Review', type: 'date' },
    { key: 'engagementType', label: 'Engagement Type', type: 'select', options: ['Resource', 'Consultant'] },
  ],
};

/**
 * Keeps only keys defined for the given business unit, coerced/validated
 * per field type. Unknown units get {} (no custom fields defined yet).
 * Blank/invalid values are dropped rather than stored as empty strings.
 */
export function sanitizeCustomFields(businessUnit, rawFields) {
  const defs = BUSINESS_UNIT_CUSTOM_FIELDS[businessUnit];
  if (!defs || !rawFields || typeof rawFields !== 'object' || Array.isArray(rawFields)) return {};
  const out = {};
  for (const def of defs) {
    if (!(def.key in rawFields)) continue;
    const raw = rawFields[def.key];
    if (raw === '' || raw == null) continue;
    if (def.type === 'number') {
      const n = Number(raw);
      if (Number.isFinite(n)) out[def.key] = n;
    } else if (def.type === 'date') {
      const s = String(raw).slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) out[def.key] = s;
    } else if (def.type === 'select') {
      if (def.options.includes(raw)) out[def.key] = raw;
    } else {
      out[def.key] = String(raw).trim().slice(0, 500);
    }
  }
  return out;
}
