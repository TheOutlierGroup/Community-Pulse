import { CLIENT_SERVICE_OPTIONS } from '../utils/clientServices.js';

export {
  CLIENT_SERVICE_LICENSEE,
  CLIENT_SERVICE_OTHER,
  CLIENT_SERVICE_PULSE,
  CLIENT_SERVICE_OPTIONS,
  normalizeServiceCatalog,
  normalizeSettings,
  normalizeServices,
  hasService,
  clientServiceBadgeClass,
} from '../utils/clientServices.js';

export const CLIENT_STATUS_PARENT_CLIENT = 'client';
export const CLIENT_STATUS_PARENT_PROSPECT = 'prospect';
export const CLIENT_STATUS_PARENT_DO_NOT_CALL_CONTACT = 'do-not-call-contact';
export const DEFAULT_CLIENT_STATUS = 'client-current';

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

// client_status is now a simple Current/Previous flag — "Prospect" and "Do
// not call/contact" statuses have moved entirely to the CRM Prospects layer
// (lead status + the do-not-contact flag). Legacy client_status values are
// still recognized above for label/badge lookups on any existing org that
// hasn't been re-saved yet, but Current/Previous is the only option set
// offered in the editable picker going forward.
export const CURRENT_PREVIOUS_OPTIONS = CLIENT_STATUS_TREE.find(
  (group) => group.id === CLIENT_STATUS_PARENT_CLIENT
).options;

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

// Independent of client_status: a warm/cold/lost/new relationship status,
// shared vocabulary between Prospects and Clients so it can carry through
// cleanly on promotion. (The old "Active Campaign" value was retired in
// migration 075 — campaign membership now lives in the Campaigns feature.)
export const DEFAULT_RELATIONSHIP_STATUS = 'new';

export const RELATIONSHIP_STATUS_OPTIONS = [
  { id: 'warm', label: 'Warm' },
  { id: 'cold', label: 'Cold' },
  { id: 'lost', label: 'Lost' },
  { id: 'new', label: 'New' },
];

const RELATIONSHIP_STATUS_SET = new Set(RELATIONSHIP_STATUS_OPTIONS.map((o) => o.id));

const RELATIONSHIP_STATUS_BADGE_CLASS = {
  warm: 'badge-open',
  cold: 'badge-cold',
  lost: 'badge-lost',
  new: 'badge',
};

export function normalizeRelationshipStatus(value) {
  const raw = String(value || '').trim().toLowerCase();
  return RELATIONSHIP_STATUS_SET.has(raw) ? raw : DEFAULT_RELATIONSHIP_STATUS;
}

export function relationshipStatusLabel(value) {
  const normalized = normalizeRelationshipStatus(value);
  return RELATIONSHIP_STATUS_OPTIONS.find((o) => o.id === normalized)?.label || 'New';
}

export function relationshipStatusBadgeClass(value) {
  return RELATIONSHIP_STATUS_BADGE_CLASS[normalizeRelationshipStatus(value)] || 'badge';
}

export function currentPreviousLabel(value) {
  return normalizeClientStatus(value) === 'client-previous' ? 'Previous' : 'Current';
}

// Compound badge shown wherever a client's status is displayed:
// "Current — Warm", colored by relationship status.
export function clientCompositeStatusLabel(clientStatus, relationshipStatus) {
  return `${currentPreviousLabel(clientStatus)} — ${relationshipStatusLabel(relationshipStatus)}`;
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
