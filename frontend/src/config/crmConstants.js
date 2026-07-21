export const BUSINESS_UNITS = [
  'Outlier Core',
  'Outlier Skate',
  'Rhythm Engine',
  'Adoption Accelerator',
  'AI-Human Workforce Design',
  'ET Inc',
];

// Standardised colour convention for Business Units, used as an accent
// wherever a BU is shown (Prospects list, Prospect header, Contacts "linked
// to" badges, etc). Backed by CSS classes in styles/crm.css — keep both in
// sync when adding a BU.
export const BUSINESS_UNIT_BADGE_CLASS = {
  'Outlier Core': 'badge-bu-outlier-core',
  'Outlier Skate': 'badge-bu-outlier-skate',
  'Rhythm Engine': 'badge-bu-rhythm-engine',
  'Adoption Accelerator': 'badge-bu-adoption-accelerator',
  'AI-Human Workforce Design': 'badge-bu-ai-human',
  'ET Inc': 'badge-bu-et-inc',
};

export function businessUnitBadgeClass(businessUnit) {
  return BUSINESS_UNIT_BADGE_CLASS[businessUnit] || 'badge';
}

// ── Campaigns ──────────────────────────────────────────────────────────────
// Multichannel outreach/marketing channels a campaign or stage can use. Ids are
// validated on the backend in backend/src/models/Campaign.js — keep in sync.
export const CAMPAIGN_CHANNELS = [
  { id: 'linkedin', label: 'LinkedIn' },
  { id: 'email', label: 'Email' },
  { id: 'phone', label: 'Phone' },
  { id: 'paid-ads', label: 'Paid Ads' },
  { id: 'organic-social', label: 'Organic Social' },
  { id: 'pr', label: 'PR' },
  { id: 'podcast', label: 'Podcast' },
  { id: 'web', label: 'Web / Landing' },
  { id: 'quiz', label: 'Quiz' },
  { id: 'other', label: 'Other' },
];

export function campaignChannelLabel(id) {
  return CAMPAIGN_CHANNELS.find((c) => c.id === id)?.label || id;
}

export const CAMPAIGN_STATUSES = [
  { id: 'draft', label: 'Draft' },
  { id: 'active', label: 'Active' },
  { id: 'paused', label: 'Paused' },
  { id: 'archived', label: 'Archived' },
];

export function campaignStatusLabel(id) {
  return CAMPAIGN_STATUSES.find((s) => s.id === id)?.label || 'Draft';
}

export function campaignStatusBadgeClass(id) {
  if (id === 'active') return 'badge badge-active';
  if (id === 'paused') return 'badge badge-on-hold';
  if (id === 'archived') return 'badge badge-lost';
  return 'badge';
}

// Above / below the line — a campaign-level classification (broad brand reach
// vs. targeted direct outreach).
export const ATL_BTL_OPTIONS = [
  { id: 'atl', label: 'ATL' },
  { id: 'btl', label: 'BTL' },
];

export function atlBtlLabel(id) {
  return ATL_BTL_OPTIONS.find((o) => o.id === id)?.label || '';
}

export const LEAD_STATUSES = ['New', 'Contacted', 'Qualified', 'Proposal', 'Negotiation', 'Won', 'Lost', 'On Hold'];

export const LEAD_STATUS_BADGE = {
  New:         'badge',
  Contacted:   'badge badge-open',
  Qualified:   'badge badge-open',
  Proposal:    'badge badge-on-hold',
  Negotiation: 'badge badge-on-hold',
  Won:         'badge badge-won',
  Lost:        'badge badge-lost',
  'On Hold':   'badge badge-on-hold',
};

// Business-Unit-specific extra fields for Prospects, stored in the generic
// custom_fields JSONB column so future BUs can get their own field sets
// without a migration each time. Mirrored on the backend in
// backend/src/services/prospectCustomFields.js — keep both in sync.
export const AUSTRALIAN_STATES = ['NSW', 'QLD', 'SA', 'TAS', 'VIC', 'WA', 'ACT', 'NT'];

export const BUSINESS_UNIT_CUSTOM_FIELDS = {
  'Outlier Skate': [
    { key: 'state', label: 'State', type: 'select', options: AUSTRALIAN_STATES },
    { key: 'town', label: 'Town', type: 'text' },
    { key: 'amountWon', label: 'Amount Won so far', type: 'number' },
    { key: 'nextAuditDate', label: 'Date of Next Audit', type: 'date' },
    { key: 'numSkateparks', label: 'Number of Skateparks', type: 'number' },
    { key: 'nextStrategyReviewDate', label: 'Date of Next Strategy Review', type: 'date' },
    { key: 'engagementType', label: 'Engagement Type', type: 'select', options: ['Resource', 'Consultant'] },
  ],
};
