export const CLIENT_SERVICE_PULSE = 'pulse';

const KNOWN_CLIENT_SERVICES = new Set([CLIENT_SERVICE_PULSE]);

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

export function normalizeClientServiceIds(rawServices) {
  if (!Array.isArray(rawServices)) return [];
  const out = [];
  for (const service of rawServices) {
    const id = String(service || '')
      .trim()
      .toLowerCase();
    if (!id || !KNOWN_CLIENT_SERVICES.has(id) || out.includes(id)) continue;
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

