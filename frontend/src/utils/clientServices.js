export const CLIENT_SERVICE_PULSE = 'pulse';
export const CLIENT_SERVICE_HUMAN_AI = 'human-ai';
export const CLIENT_SERVICE_ADOPTION_ACCELERATOR = 'adoption-accelerator';
export const CLIENT_SERVICE_PROJECT_RESOURCES = 'project-resources';
export const CLIENT_SERVICE_OG_SKATE_AUDIT = 'og-skate-audit';
export const CLIENT_SERVICE_OG_SKATE_STRATEGY = 'og-skate-strategy';
export const CLIENT_SERVICE_OG_SKATE_COMMUNITY_ENGAGEMENT = 'og-skate-community-engagement';
export const CLIENT_SERVICE_OG_SKATE_OTHER = 'og-skate-other';

export const CLIENT_SERVICE_OPTIONS = [
  { id: CLIENT_SERVICE_PULSE, label: 'Pulse' },
  { id: CLIENT_SERVICE_HUMAN_AI, label: 'Human AI' },
  { id: CLIENT_SERVICE_ADOPTION_ACCELERATOR, label: 'Adoption Accelerator' },
  { id: CLIENT_SERVICE_PROJECT_RESOURCES, label: 'Project Resources' },
  { id: CLIENT_SERVICE_OG_SKATE_AUDIT, label: 'OG Skate - Audit' },
  { id: CLIENT_SERVICE_OG_SKATE_STRATEGY, label: 'OG Skate - Strategy' },
  { id: CLIENT_SERVICE_OG_SKATE_COMMUNITY_ENGAGEMENT, label: 'OG Skate - Community Engagement' },
  { id: CLIENT_SERVICE_OG_SKATE_OTHER, label: 'OG Skate - Other' },
];

const KNOWN_CLIENT_SERVICES = new Set(CLIENT_SERVICE_OPTIONS.map((service) => service.id));

export function normalizeSettings(raw) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw;
  return {};
}

export function normalizeServices(rawSettings) {
  const settings = normalizeSettings(rawSettings);
  const hasExplicitServices = Array.isArray(settings.services);
  const services = hasExplicitServices ? settings.services : [];
  const out = [];
  for (const service of services) {
    const id = String(service || '')
      .trim()
      .toLowerCase();
    if (!id || !KNOWN_CLIENT_SERVICES.has(id) || out.includes(id)) continue;
    out.push(id);
  }

  // Back-compat for orgs that only used pulseEnabled before services existed.
  if (!hasExplicitServices && out.length === 0 && settings.pulseEnabled === true) {
    out.push(CLIENT_SERVICE_PULSE);
  }
  return out;
}

export function hasService(rawSettings, serviceId) {
  const id = String(serviceId || '')
    .trim()
    .toLowerCase();
  if (!id) return false;
  return normalizeServices(rawSettings).includes(id);
}

export function userHasService(user, serviceId) {
  const id = String(serviceId || '')
    .trim()
    .toLowerCase();
  if (!id) return false;
  const enabled = Array.isArray(user?.enabledServices) ? user.enabledServices : [];
  return enabled.includes(id);
}
