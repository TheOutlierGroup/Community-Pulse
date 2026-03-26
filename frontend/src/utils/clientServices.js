export const CLIENT_SERVICE_PULSE = 'pulse';

const KNOWN_CLIENT_SERVICES = new Set([CLIENT_SERVICE_PULSE]);

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
