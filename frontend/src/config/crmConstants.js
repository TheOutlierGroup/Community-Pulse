export const BUSINESS_UNITS = [
  'Outlier Core',
  'Outlier Skate',
  'Rhythm Engine',
  'Adoption Accelerator',
  'AI-Human Workforce Design',
  'ET Inc',
];

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
