import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeCustomFilterDefinition,
  isEmptyDefinition,
  contactMatchesFilter,
  applyCustomFilter,
  customFilterReach,
  describeCustomFilter,
} from './customFilters.js';

const contacts = [
  { contact_id: 1, contact_firstname: 'Kay', contact_lastname: 'Clancy', contact_role: 'Group Chief People Officer', contact_email: 'kay@wise.com', contact_phone: '', relationship_status: 'warm', crm_organisation_id: 10, prospect_business_unit: 'Rhythm Engine' },
  { contact_id: 2, contact_firstname: 'Leanne', contact_lastname: 'Hopkins', contact_role: 'HR Business Partner', contact_email: '', contact_phone: '0400 000 000', relationship_status: 'new', client_organization_id: 'abc', client_business_unit: 'Outlier Skate' },
  { contact_id: 3, contact_firstname: 'Sam', contact_lastname: 'Referral', contact_role: 'Director', contact_email: 'sam@x.com', contact_phone: '123', relationship_status: 'cold' },
];

test('normalizeCustomFilterDefinition drops unknown keys and coerces types', () => {
  const def = normalizeCustomFilterDefinition({
    search: '  gov ', linkType: 'bogus', businessUnit: 'Not A BU',
    roleContains: 'Chief', relationshipStatuses: ['warm', 'nope', 'warm'],
    hasEmail: 'yes', hasPhone: true, junk: 1,
  });
  assert.equal(def.search, 'gov');
  assert.equal(def.linkType, ''); // invalid link type falls back to any
  assert.equal(def.businessUnit, ''); // invalid BU dropped
  assert.deepEqual(def.relationshipStatuses, ['warm']); // deduped, filtered
  assert.equal(def.hasEmail, false); // only literal true counts
  assert.equal(def.hasPhone, true);
  assert.equal('junk' in def, false);
});

test('isEmptyDefinition detects no-op filters', () => {
  assert.equal(isEmptyDefinition({}), true);
  assert.equal(isEmptyDefinition({ hasEmail: true }), false);
  assert.equal(isEmptyDefinition({ relationshipStatuses: ['warm'] }), false);
});

test('roleContains matches case-insensitively', () => {
  const def = { roleContains: 'chief' };
  assert.equal(contactMatchesFilter(contacts[0], def), true);
  assert.equal(contactMatchesFilter(contacts[1], def), false);
});

test('linkType filters prospect / client / unlinked', () => {
  assert.deepEqual(applyCustomFilter(contacts, { linkType: 'prospect' }).map((c) => c.contact_id), [1]);
  assert.deepEqual(applyCustomFilter(contacts, { linkType: 'client' }).map((c) => c.contact_id), [2]);
  assert.deepEqual(applyCustomFilter(contacts, { linkType: 'unlinked' }).map((c) => c.contact_id), [3]);
});

test('businessUnit matches the linked org BU', () => {
  assert.deepEqual(applyCustomFilter(contacts, { businessUnit: 'Rhythm Engine' }).map((c) => c.contact_id), [1]);
});

test('relationshipStatuses is an OR set; empty means any', () => {
  assert.deepEqual(applyCustomFilter(contacts, { relationshipStatuses: ['warm', 'cold'] }).map((c) => c.contact_id), [1, 3]);
  assert.equal(applyCustomFilter(contacts, { relationshipStatuses: [] }).length, 3);
});

test('hasEmail / hasPhone gate on presence', () => {
  assert.deepEqual(applyCustomFilter(contacts, { hasEmail: true }).map((c) => c.contact_id), [1, 3]);
  assert.deepEqual(applyCustomFilter(contacts, { hasPhone: true }).map((c) => c.contact_id), [2, 3]);
});

test('search spans name, email and role', () => {
  assert.deepEqual(applyCustomFilter(contacts, { search: 'wise.com' }).map((c) => c.contact_id), [1]);
  assert.deepEqual(applyCustomFilter(contacts, { search: 'referral' }).map((c) => c.contact_id), [3]);
});

test('predicates combine with AND', () => {
  const def = { relationshipStatuses: ['warm', 'cold'], hasPhone: true };
  assert.deepEqual(applyCustomFilter(contacts, def).map((c) => c.contact_id), [3]);
});

test('customFilterReach counts totals and per-channel reachability', () => {
  assert.deepEqual(customFilterReach(contacts), { total: 3, email: 2, phone: 2 });
});

test('describeCustomFilter summarises, or says all contacts when empty', () => {
  assert.equal(describeCustomFilter({}), 'All contacts (no filters)');
  assert.match(describeCustomFilter({ businessUnit: 'Rhythm Engine', hasEmail: true }), /Rhythm Engine/);
});
