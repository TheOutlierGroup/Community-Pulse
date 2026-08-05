export const CLIENT_SERVICE_PULSE = 'pulse';
export const CLIENT_SERVICE_OTHER = 'other';
export const CLIENT_SERVICE_HUMAN_AI = 'human-ai';
export const CLIENT_SERVICE_ADOPTION_ACCELERATOR = 'adoption-accelerator';
export const CLIENT_SERVICE_PROJECT_RESOURCES = 'project-resources';
export const CLIENT_SERVICE_OG_SKATE_AUDIT = 'og-skate-audit';
export const CLIENT_SERVICE_OG_SKATE_STRATEGY = 'og-skate-strategy';
export const CLIENT_SERVICE_OG_SKATE_COMMUNITY_ENGAGEMENT = 'og-skate-community-engagement';
export const CLIENT_SERVICE_OG_SKATE_OTHER = 'og-skate-other';
export const CLIENT_SERVICE_LICENSEE = 'rhythm-engine-licensee';
export const CLIENT_SERVICE_ET_INC = 'et-inc';

export const CLIENT_SERVICE_OPTIONS = [
  { id: CLIENT_SERVICE_PULSE, label: 'Rhythm Engine' },
  { id: CLIENT_SERVICE_LICENSEE, label: 'Rhythm Engine Licensee' },
  { id: CLIENT_SERVICE_OTHER, label: 'Other' },
  { id: CLIENT_SERVICE_HUMAN_AI, label: 'AI-Human Workforce Design' },
  { id: CLIENT_SERVICE_ADOPTION_ACCELERATOR, label: 'Adoption Accelerator' },
  { id: CLIENT_SERVICE_PROJECT_RESOURCES, label: 'Project Resources' },
  { id: CLIENT_SERVICE_OG_SKATE_AUDIT, label: 'Outlier Skate - Audit' },
  { id: CLIENT_SERVICE_OG_SKATE_STRATEGY, label: 'Outlier Skate - Strategy' },
  { id: CLIENT_SERVICE_OG_SKATE_COMMUNITY_ENGAGEMENT, label: 'Outlier Skate - Community Engagement' },
  { id: CLIENT_SERVICE_OG_SKATE_OTHER, label: 'Outlier Skate - Other' },
  { id: CLIENT_SERVICE_ET_INC, label: 'ET Inc' },
];

const LOCKED_CLIENT_SERVICES = [
  { id: CLIENT_SERVICE_PULSE, name: 'Rhythm Engine' },
  { id: CLIENT_SERVICE_LICENSEE, name: 'Rhythm Engine Licensee' },
  { id: CLIENT_SERVICE_OTHER, name: 'Other' },
];

// Services available when a licensee provisions a downstream client. Licensees
// cannot self-manage the wider service catalog; only Rhythm Engine and Other
// are available to their clients.
export const LICENSEE_DOWNSTREAM_SERVICE_IDS = new Set([
  CLIENT_SERVICE_PULSE,
  CLIENT_SERVICE_OTHER,
]);

export const LICENSEE_DOWNSTREAM_SERVICE_CATALOG = [
  { id: CLIENT_SERVICE_PULSE, name: 'Rhythm Engine' },
  { id: CLIENT_SERVICE_OTHER, name: 'Other' },
];

// Maps the granular client service catalog onto the coarser Business Unit
// vocabulary crm_organisations (Prospects) and user_business_units use, so a
// Basic-tier platform user's BU tags can also scope which Clients they see.
//
// D-014: CLIENT_SERVICE_OTHER and CLIENT_SERVICE_PROJECT_RESOURCES were
// previously left unmapped here, which meant "Outlier Core" -- despite
// being a real, assignable BU tag (and the default business_unit for a
// new Prospect, see CrmOrganisation.js) -- had no client service that
// could ever map into it. A Basic-tier user scoped only to "Outlier Core"
// could never see any client through this mechanism, and clients whose
// only service was Project Resources were invisible to every BU tag.
// Other/Project Resources are the general, unspecialised services, so
// they map to Outlier Core, the general/default BU.
const CLIENT_SERVICE_TO_BUSINESS_UNIT = {
  [CLIENT_SERVICE_PULSE]: 'Rhythm Engine',
  [CLIENT_SERVICE_LICENSEE]: 'Rhythm Engine',
  [CLIENT_SERVICE_OTHER]: 'Outlier Core',
  [CLIENT_SERVICE_PROJECT_RESOURCES]: 'Outlier Core',
  [CLIENT_SERVICE_HUMAN_AI]: 'AI-Human Workforce Design',
  [CLIENT_SERVICE_ADOPTION_ACCELERATOR]: 'Adoption Accelerator',
  [CLIENT_SERVICE_OG_SKATE_AUDIT]: 'Outlier Skate',
  [CLIENT_SERVICE_OG_SKATE_STRATEGY]: 'Outlier Skate',
  [CLIENT_SERVICE_OG_SKATE_COMMUNITY_ENGAGEMENT]: 'Outlier Skate',
  [CLIENT_SERVICE_OG_SKATE_OTHER]: 'Outlier Skate',
  [CLIENT_SERVICE_ET_INC]: 'ET Inc',
};

/** Business Units represented by a client's enabled service catalog. */
export function businessUnitsForEnabledServices(enabledServiceIds) {
  const ids = Array.isArray(enabledServiceIds) ? enabledServiceIds : [];
  const units = new Set();
  for (const id of ids) {
    const bu = CLIENT_SERVICE_TO_BUSINESS_UNIT[id];
    if (bu) units.add(bu);
  }
  return [...units];
}

/** True if any of a client's enabled services map into the given BU tag set. */
export function organizationVisibleToBusinessUnits(rawSettings, businessUnits) {
  if (!Array.isArray(businessUnits) || businessUnits.length === 0) return false;
  const allowed = new Set(businessUnits);
  const enabled = enabledServicesFromOrganizationSettings(rawSettings);
  return enabled.some((id) => allowed.has(CLIENT_SERVICE_TO_BUSINESS_UNIT[id]));
}

function normalizeServiceId(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeServiceName(value) {
  return String(value || '').trim();
}

function titleCaseFromId(id) {
  return String(id || '')
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function normalizeClientServiceCatalog(rawCatalog, { fallbackToDefaults = true } = {}) {
  const source = Array.isArray(rawCatalog) ? rawCatalog : [];
  const fallback = CLIENT_SERVICE_OPTIONS.map((service) => ({
    id: service.id,
    name: service.label,
  }));
  const input = source.length ? source : fallbackToDefaults ? fallback : [];
  const usedIds = new Set();
  const out = [];

  for (const service of input) {
    const fromObj = service && typeof service === 'object' && !Array.isArray(service);
    const rawId = fromObj ? service.id : '';
    const rawName = fromObj ? (service.name ?? service.label) : service;
    const baseId = normalizeServiceId(rawId || rawName);
    const name = normalizeServiceName(rawName) || titleCaseFromId(baseId);
    if (!baseId || !name) continue;
    let nextId = baseId;
    let dedupeIndex = 2;
    while (usedIds.has(nextId)) {
      nextId = `${baseId}-${dedupeIndex}`;
      dedupeIndex += 1;
    }
    usedIds.add(nextId);
    out.push({ id: nextId, name });
  }

  const seeded = out.length > 0 ? out : fallbackToDefaults ? fallback : [];
  const lockedServiceIds = new Set(LOCKED_CLIENT_SERVICES.map((service) => service.id));
  const withoutLocked = seeded.filter((service) => !lockedServiceIds.has(service.id));
  return [...LOCKED_CLIENT_SERVICES, ...withoutLocked];
}

export function normalizeOrganizationSettings(raw) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch {
      return {};
    }
  }
  return {};
}

export function clientServiceCatalogFromPlatformSettings(rawPlatformSettings) {
  const settings = normalizeOrganizationSettings(rawPlatformSettings);
  const hasExplicitCatalog = Array.isArray(settings.serviceCatalog);
  return normalizeClientServiceCatalog(settings.serviceCatalog, {
    fallbackToDefaults: !hasExplicitCatalog,
  });
}

export function normalizeClientServiceIds(rawServices, allowedServiceIds = null) {
  if (!Array.isArray(rawServices)) return [];
  const allowed =
    allowedServiceIds instanceof Set
      ? allowedServiceIds
      : Array.isArray(allowedServiceIds)
        ? new Set(allowedServiceIds.map((id) => normalizeServiceId(id)).filter(Boolean))
        : null;
  const out = [];
  for (const service of rawServices) {
    const id = normalizeServiceId(service);
    if (!id || (allowed && !allowed.has(id)) || out.includes(id)) continue;
    out.push(id);
  }
  return out;
}

export function enabledServicesFromOrganizationSettings(rawSettings) {
  const settings = normalizeOrganizationSettings(rawSettings);
  const hasExplicitServices = Array.isArray(settings.services);
  const out = normalizeClientServiceIds(settings.services);
  if (!hasExplicitServices && out.length === 0 && settings.pulseEnabled === true) {
    out.push(CLIENT_SERVICE_PULSE);
  }
  return out;
}

export function organizationHasService(rawSettings, serviceId) {
  const id = String(serviceId || '')
    .trim()
    .toLowerCase();
  if (!id) return false;
  return enabledServicesFromOrganizationSettings(rawSettings).includes(id);
}

// Self-service CRM portal access tier for a client organization. This is
// deliberately a separate axis from LicenseConfig's `licenseTier` (a
// commercial Rhythm Engine billing/quota tier: practitioner/enterprise_mid/
// enterprise_large/enterprise_unlimited, stored in licence_config) — this
// one only controls whether a client's own users get self-service access
// to the Dashboard/Users/Tasks/Rhythm Engine workspace nav, stored on
// organizations.settings like `services`/`pulseEnabled`.
export const CLIENT_PORTAL_TIER_STANDARD = 'standard';
export const CLIENT_PORTAL_TIER_ENTERPRISE = 'enterprise';

export function clientPortalTierFromOrganizationSettings(rawSettings) {
  const settings = normalizeOrganizationSettings(rawSettings);
  const tier = String(settings.clientPortalTier || '').trim().toLowerCase();
  return tier === CLIENT_PORTAL_TIER_ENTERPRISE ? CLIENT_PORTAL_TIER_ENTERPRISE : CLIENT_PORTAL_TIER_STANDARD;
}

export function organizationHasEnterprisePortalTier(rawSettings) {
  return clientPortalTierFromOrganizationSettings(rawSettings) === CLIENT_PORTAL_TIER_ENTERPRISE;
}

