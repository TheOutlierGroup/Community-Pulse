// A segment is a named, saved filter over the contacts list. Its definition is
// a small set of predicates that map onto contact fields. The predicates are
// applied client-side here today (the manual dataset is small); once CSV import
// lands and contact volumes grow, this same shape moves server-side and gains
// real counts. The backend mirrors this normaliser in
// backend/src/models/CrmSegment.js — keep the two in sync.

import { BUSINESS_UNITS } from '../config/crmConstants.js';
import { RELATIONSHIP_STATUS_OPTIONS } from '../pages/platformClientUtils.js';

export const LINK_TYPE_OPTIONS = [
  { value: '', label: 'Any link' },
  { value: 'prospect', label: 'Linked to a prospect' },
  { value: 'client', label: 'Linked to a client' },
  { value: 'unlinked', label: 'Unlinked' },
];

const LINK_TYPES = new Set(LINK_TYPE_OPTIONS.map((o) => o.value));
const RELATIONSHIP_STATUS_IDS = new Set(RELATIONSHIP_STATUS_OPTIONS.map((o) => o.id));

export const EMPTY_SEGMENT_DEFINITION = {
  search: '',
  linkType: '',
  businessUnit: '',
  roleContains: '',
  relationshipStatuses: [],
  hasEmail: false,
  hasPhone: false,
};

export function normalizeSegmentDefinition(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return {
    search: typeof src.search === 'string' ? src.search.trim() : '',
    linkType: LINK_TYPES.has(src.linkType) ? src.linkType : '',
    businessUnit: BUSINESS_UNITS.includes(src.businessUnit) ? src.businessUnit : '',
    roleContains: typeof src.roleContains === 'string' ? src.roleContains.trim() : '',
    relationshipStatuses: Array.isArray(src.relationshipStatuses)
      ? [...new Set(src.relationshipStatuses.filter((s) => RELATIONSHIP_STATUS_IDS.has(s)))]
      : [],
    hasEmail: src.hasEmail === true,
    hasPhone: src.hasPhone === true,
  };
}

// True when a definition would filter nothing out — used to warn before saving
// an "empty" segment that just mirrors the full contact list.
export function isEmptyDefinition(def) {
  const d = normalizeSegmentDefinition(def);
  return (
    !d.search &&
    !d.linkType &&
    !d.businessUnit &&
    !d.roleContains &&
    d.relationshipStatuses.length === 0 &&
    !d.hasEmail &&
    !d.hasPhone
  );
}

function contactLinkType(contact) {
  if (contact.crm_organisation_id) return 'prospect';
  if (contact.client_organization_id) return 'client';
  return 'unlinked';
}

function contactBusinessUnit(contact) {
  // A contact inherits the BU of whichever org it's linked to (same accent the
  // Contacts "linked to" badge uses).
  return contact.prospect_business_unit || contact.client_business_unit || '';
}

export function contactMatchesSegment(contact, rawDef) {
  const def = normalizeSegmentDefinition(rawDef);

  if (def.search) {
    const needle = def.search.toLowerCase();
    const haystack = [
      contact.contact_firstname,
      contact.contact_lastname,
      contact.contact_email,
      contact.contact_role,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    if (!haystack.includes(needle)) return false;
  }

  if (def.linkType && contactLinkType(contact) !== def.linkType) return false;

  if (def.businessUnit && contactBusinessUnit(contact) !== def.businessUnit) return false;

  if (def.roleContains) {
    const role = String(contact.contact_role || '').toLowerCase();
    if (!role.includes(def.roleContains.toLowerCase())) return false;
  }

  if (def.relationshipStatuses.length > 0) {
    const status = String(contact.relationship_status || 'new');
    if (!def.relationshipStatuses.includes(status)) return false;
  }

  if (def.hasEmail && !String(contact.contact_email || '').trim()) return false;
  if (def.hasPhone && !String(contact.contact_phone || '').trim()) return false;

  return true;
}

export function applySegment(contacts, rawDef) {
  const list = Array.isArray(contacts) ? contacts : [];
  return list.filter((c) => contactMatchesSegment(c, rawDef));
}

// Reachability counts for a set of contacts, per outreach channel. Phone here
// is "has a number" — the Firmable Do-Not-Call flag isn't imported yet, so a
// DNC-aware phone count is a follow-up once enrichment lands.
export function segmentReach(contacts) {
  const list = Array.isArray(contacts) ? contacts : [];
  let email = 0;
  let phone = 0;
  for (const c of list) {
    if (String(c.contact_email || '').trim()) email += 1;
    if (String(c.contact_phone || '').trim()) phone += 1;
  }
  return { total: list.length, email, phone };
}

// Short human-readable summary of what a segment filters on, for list rows.
export function describeSegment(rawDef) {
  const def = normalizeSegmentDefinition(rawDef);
  const parts = [];
  if (def.search) parts.push(`matches “${def.search}”`);
  if (def.roleContains) parts.push(`role has “${def.roleContains}”`);
  const linkLabel = LINK_TYPE_OPTIONS.find((o) => o.value === def.linkType && o.value)?.label;
  if (linkLabel) parts.push(linkLabel.toLowerCase());
  if (def.businessUnit) parts.push(def.businessUnit);
  if (def.relationshipStatuses.length > 0) {
    parts.push(
      def.relationshipStatuses
        .map((s) => RELATIONSHIP_STATUS_OPTIONS.find((o) => o.id === s)?.label || s)
        .join(' / '),
    );
  }
  if (def.hasEmail) parts.push('has email');
  if (def.hasPhone) parts.push('has phone');
  return parts.length ? parts.join(' · ') : 'All contacts (no filters)';
}
