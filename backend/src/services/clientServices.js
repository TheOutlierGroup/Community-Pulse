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

