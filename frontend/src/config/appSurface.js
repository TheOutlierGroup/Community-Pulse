const rawSurface = String(import.meta.env.VITE_APP_SURFACE || 'crm').toLowerCase();

export const APP_SURFACE = rawSurface === 'pulse' ? 'pulse' : rawSurface === 'all' ? 'all' : 'crm';
export const IS_PULSE_SURFACE = APP_SURFACE === 'pulse';
export const IS_CRM_SURFACE = APP_SURFACE === 'crm';

function normalizeBaseUrl(value) {
  const v = String(value || '').trim();
  if (!v) return '';
  return v.replace(/\/$/, '');
}

export function crmLoginUrl() {
  const configured = normalizeBaseUrl(import.meta.env.VITE_CRM_APP_URL);
  if (configured) return `${configured}/login`;
  return '/login';
}

export function pulseAppBaseUrl() {
  return normalizeBaseUrl(import.meta.env.VITE_PULSE_APP_URL);
}
