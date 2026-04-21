import { CLIENT_SERVICE_OPTIONS } from '../utils/clientServices.js';

export {
  CLIENT_SERVICE_OTHER,
  CLIENT_SERVICE_PULSE,
  CLIENT_SERVICE_OPTIONS,
  normalizeServiceCatalog,
  normalizeSettings,
  normalizeServices,
  hasService,
} from '../utils/clientServices.js';

export const CLIENT_STATUS_PARENT_CLIENT = 'client';
export const CLIENT_STATUS_PARENT_PROSPECT = 'prospect';
export const CLIENT_STATUS_PARENT_DO_NOT_CALL_CONTACT = 'do-not-call-contact';
export const DEFAULT_CLIENT_STATUS = 'prospect-new';

const CLIENT_STATUS_LEGACY_MAP = new Map([
  ['lead', 'prospect-new'],
  ['active', 'client-current'],
  ['inactive', 'client-previous'],
  ['closed', 'do-not-call-contact-blocked'],
]);

const CLIENT_STATUS_TREE = [
  {
    id: CLIENT_STATUS_PARENT_CLIENT,
    label: 'Client',
    options: [
      { id: 'client-current', label: 'Current' },
      { id: 'client-previous', label: 'Previous' },
    ],
  },
  {
    id: CLIENT_STATUS_PARENT_PROSPECT,
    label: 'Prospect',
    options: [
      { id: 'prospect-warm', label: 'Warm' },
      { id: 'prospect-cold', label: 'Cold' },
      { id: 'prospect-lost', label: 'Lost' },
      { id: 'prospect-new', label: 'New' },
      { id: 'prospect-active-campaign', label: 'Active Campaign' },
    ],
  },
  {
    id: CLIENT_STATUS_PARENT_DO_NOT_CALL_CONTACT,
    label: 'Do not call/contact',
    options: [{ id: 'do-not-call-contact-blocked', label: 'Do not call/contact' }],
  },
];

const CLIENT_STATUS_LOOKUP = new Map(
  CLIENT_STATUS_TREE.flatMap((group) =>
    group.options.map((option) => [
      option.id,
      {
        statusId: option.id,
        parentId: group.id,
        parentLabel: group.label,
        subLabel: option.label,
      },
    ])
  )
);

const CLIENT_STATUS_SET = new Set(CLIENT_STATUS_LOOKUP.keys());

export const CLIENT_STATUS_OPTIONS = CLIENT_STATUS_TREE.flatMap((group) => group.options);
export const CLIENT_STATUS_PARENT_OPTIONS = CLIENT_STATUS_TREE.map((group) => ({
  id: group.id,
  label: group.label,
}));

export function normalizeClientStatus(value) {
  const raw = String(value || '')
    .trim()
    .toLowerCase();
  const status = CLIENT_STATUS_LEGACY_MAP.get(raw) || raw;
  if (!CLIENT_STATUS_SET.has(status)) return DEFAULT_CLIENT_STATUS;
  return status;
}

function getStatusMeta(value) {
  const normalized = normalizeClientStatus(value);
  return (
    CLIENT_STATUS_LOOKUP.get(normalized) ||
    CLIENT_STATUS_LOOKUP.get(DEFAULT_CLIENT_STATUS)
  );
}

export function clientStatusSubOptions(parentId) {
  const normalizedParentId = String(parentId || '')
    .trim()
    .toLowerCase();
  const group = CLIENT_STATUS_TREE.find((entry) => entry.id === normalizedParentId);
  if (!group || group.options.length === 0) {
    return CLIENT_STATUS_TREE.find((entry) => entry.id === CLIENT_STATUS_PARENT_PROSPECT).options;
  }
  return group.options;
}

export function composeClientStatus(parentId, subStatusId) {
  const options = clientStatusSubOptions(parentId);
  const requested = normalizeClientStatus(subStatusId);
  const valid = options.find((option) => option.id === requested);
  return valid?.id || options[0]?.id || DEFAULT_CLIENT_STATUS;
}

export function clientStatusParent(value) {
  return getStatusMeta(value).parentId;
}

export function clientStatusLabel(value) {
  const meta = getStatusMeta(value);
  if (meta.parentLabel === meta.subLabel) return meta.parentLabel;
  return `${meta.parentLabel} - ${meta.subLabel}`;
}

export function clientStatusBadgeClass(value) {
  const status = normalizeClientStatus(value);
  const parentId = getStatusMeta(status).parentId;
  if (parentId === CLIENT_STATUS_PARENT_CLIENT) return 'active';
  if (parentId === CLIENT_STATUS_PARENT_DO_NOT_CALL_CONTACT) return 'closed';
  return 'draft';
}

export function clientServiceLabel(serviceId, serviceCatalog = null) {
  const catalog = Array.isArray(serviceCatalog) && serviceCatalog.length > 0
    ? serviceCatalog.map((service) => ({
        id: service.id,
        label: service.label ?? service.name,
      }))
    : CLIENT_SERVICE_OPTIONS;
  const id = String(serviceId || '')
    .trim()
    .toLowerCase();
  if (!id) return '';
  const known = catalog.find((service) => service.id === id);
  if (known) return known.label;
  return id
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function sessionStatusLabel(s) {
  if (s === 'active') return 'Active';
  if (s === 'closed') return 'Closed';
  return 'Draft';
}
