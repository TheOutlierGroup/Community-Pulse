import { CLIENT_SERVICE_OPTIONS } from '../utils/clientServices.js';

export {
  CLIENT_SERVICE_PULSE,
  CLIENT_SERVICE_OPTIONS,
  normalizeSettings,
  normalizeServices,
  hasService,
} from '../utils/clientServices.js';

export const CLIENT_STATUS_LEAD = 'lead';
export const CLIENT_STATUS_ACTIVE = 'active';
export const CLIENT_STATUS_INACTIVE = 'inactive';
export const CLIENT_STATUS_CLOSED = 'closed';

const CLIENT_STATUS_SET = new Set([
  CLIENT_STATUS_LEAD,
  CLIENT_STATUS_ACTIVE,
  CLIENT_STATUS_INACTIVE,
  CLIENT_STATUS_CLOSED,
]);

export const CLIENT_STATUS_OPTIONS = [
  { id: CLIENT_STATUS_LEAD, label: 'Lead' },
  { id: CLIENT_STATUS_ACTIVE, label: 'Active' },
  { id: CLIENT_STATUS_INACTIVE, label: 'Inactive' },
  { id: CLIENT_STATUS_CLOSED, label: 'Closed' },
];

export function normalizeClientStatus(value) {
  const status = String(value || '')
    .trim()
    .toLowerCase();
  if (!CLIENT_STATUS_SET.has(status)) return CLIENT_STATUS_LEAD;
  return status;
}

export function clientStatusLabel(value) {
  const status = normalizeClientStatus(value);
  if (status === CLIENT_STATUS_ACTIVE) return 'Active';
  if (status === CLIENT_STATUS_INACTIVE) return 'Inactive';
  if (status === CLIENT_STATUS_CLOSED) return 'Closed';
  return 'Lead';
}

export function clientStatusBadgeClass(value) {
  const status = normalizeClientStatus(value);
  if (status === CLIENT_STATUS_ACTIVE) return 'active';
  if (status === CLIENT_STATUS_CLOSED) return 'closed';
  return 'draft';
}

export function clientServiceLabel(serviceId) {
  const id = String(serviceId || '')
    .trim()
    .toLowerCase();
  if (!id) return '';
  const known = CLIENT_SERVICE_OPTIONS.find((service) => service.id === id);
  if (known) return known.label;
  return id.toUpperCase();
}

export function sessionStatusLabel(s) {
  if (s === 'active') return 'Active';
  if (s === 'closed') return 'Closed';
  return 'Draft';
}
