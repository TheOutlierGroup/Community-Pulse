export const CLIENT_SERVICE_PULSE = 'pulse';
export const CLIENT_SERVICE_HUMAN_AI = 'human-ai';
export const CLIENT_SERVICE_ADOPTION_ACCELERATOR = 'adoption-accelerator';
export const CLIENT_SERVICE_PROJECT_RESOURCES = 'project-resources';
export const CLIENT_SERVICE_OG_SKATE_AUDIT = 'og-skate-audit';
export const CLIENT_SERVICE_OG_SKATE_STRATEGY = 'og-skate-strategy';
export const CLIENT_SERVICE_OG_SKATE_COMMUNITY_ENGAGEMENT = 'og-skate-community-engagement';
export const CLIENT_SERVICE_OG_SKATE_OTHER = 'og-skate-other';

export const CLIENT_SERVICE_OPTIONS = [
  { id: CLIENT_SERVICE_PULSE, label: 'Rhythm Engine' },
  { id: CLIENT_SERVICE_HUMAN_AI, label: 'Human AI' },
  { id: CLIENT_SERVICE_ADOPTION_ACCELERATOR, label: 'Adoption Accelerator' },
  { id: CLIENT_SERVICE_PROJECT_RESOURCES, label: 'Project Resources' },
  { id: CLIENT_SERVICE_OG_SKATE_AUDIT, label: 'OG Skate - Audit' },
  { id: CLIENT_SERVICE_OG_SKATE_STRATEGY, label: 'OG Skate - Strategy' },
  { id: CLIENT_SERVICE_OG_SKATE_COMMUNITY_ENGAGEMENT, label: 'OG Skate - Community Engagement' },
  { id: CLIENT_SERVICE_OG_SKATE_OTHER, label: 'OG Skate - Other' },
];

const REQUIRED_CLIENT_SERVICE = {
  id: CLIENT_SERVICE_PULSE,
  name: 'Rhythm Engine',
};

function normalizeServiceId(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function titleCaseFromId(id) {
  return String(id || '')
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function normalizeSettings(raw) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw;
  return {};
}

export function normalizeServiceCatalog(rawCatalog, { fallbackToDefaults = true } = {}) {
  const source = Array.isArray(rawCatalog) ? rawCatalog : [];
  const fallback = CLIENT_SERVICE_OPTIONS.map((service) => ({
    id: service.id,
    name: service.label,
  }));
  const input = source.length ? source : fallbackToDefaults ? fallback : [];
  const usedIds = new Set();
  const out = [];

  for (const service of input) {
    const isObject = service && typeof service === 'object' && !Array.isArray(service);
    const rawId = isObject ? service.id : '';
    const rawName = isObject ? (service.name ?? service.label) : service;
    const baseId = normalizeServiceId(rawId || rawName);
    const name = String(rawName || '').trim() || titleCaseFromId(baseId);
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
  const withoutRequired = seeded.filter((service) => service.id !== REQUIRED_CLIENT_SERVICE.id);
  return [REQUIRED_CLIENT_SERVICE, ...withoutRequired];
}

export function normalizeServices(rawSettings, allowedServiceIds = null) {
  const settings = normalizeSettings(rawSettings);
  const hasExplicitServices = Array.isArray(settings.services);
  const services = hasExplicitServices ? settings.services : [];
  const allowed =
    allowedServiceIds instanceof Set
      ? allowedServiceIds
      : Array.isArray(allowedServiceIds)
        ? new Set(allowedServiceIds.map((id) => normalizeServiceId(id)).filter(Boolean))
        : null;
  const out = [];
  for (const service of services) {
    const id = normalizeServiceId(service);
    if (!id || (allowed && !allowed.has(id)) || out.includes(id)) continue;
    out.push(id);
  }

  // Back-compat for orgs that only used pulseEnabled before services existed.
  if (!hasExplicitServices && out.length === 0 && settings.pulseEnabled === true) {
    out.push(CLIENT_SERVICE_PULSE);
  }
  return out;
}

export function hasService(rawSettings, serviceId) {
  const id = normalizeServiceId(serviceId);
  if (!id) return false;
  return normalizeServices(rawSettings).includes(id);
}

export function userHasService(user, serviceId) {
  const id = normalizeServiceId(serviceId);
  if (!id) return false;
  return normalizeServices({ services: user?.enabledServices }).includes(id);
}

export function clientServiceNameById(serviceId, serviceCatalog = null) {
  const id = normalizeServiceId(serviceId);
  if (!id) return '';
  const catalog = normalizeServiceCatalog(serviceCatalog);
  const known = catalog.find((service) => service.id === id);
  if (known) return known.name;
  return titleCaseFromId(id);
}
