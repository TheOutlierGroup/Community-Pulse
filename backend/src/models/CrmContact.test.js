import test from 'node:test';
import assert from 'node:assert/strict';
import { contactVisibleToBusinessUnits } from './CrmContact.js';

// D-015: the global Contacts list returned every contact in the platform
// org to any authenticated workspace user regardless of tier -- Basic-tier
// staff, who are scoped to specific Business Units everywhere else
// (Clients, Prospects), could see contacts linked to clients and prospects
// well outside their tagged units.

test('admin/platform tier (null scope) sees everything', () => {
  assert.equal(contactVisibleToBusinessUnits({ crm_organisation_id: 'p1', prospect_business_unit: 'ET Inc' }, null), true);
});

test('a Basic-tier user with no tagged units sees nothing', () => {
  assert.equal(
    contactVisibleToBusinessUnits({ crm_organisation_id: 'p1', prospect_business_unit: 'ET Inc' }, []),
    false
  );
});

test('an unlinked contact is visible regardless of scope -- not tied to any org\'s confidential data', () => {
  assert.equal(
    contactVisibleToBusinessUnits({ crm_organisation_id: null, client_organization_id: null }, ['Rhythm Engine']),
    true
  );
});

test('a prospect-linked contact is visible only when the prospect\'s own BU tag is in scope', () => {
  const context = { crm_organisation_id: 'p1', client_organization_id: null, prospect_business_unit: 'Outlier Skate' };
  assert.equal(contactVisibleToBusinessUnits(context, ['Rhythm Engine']), false);
  assert.equal(contactVisibleToBusinessUnits(context, ['Outlier Skate']), true);
});

test('a client-linked contact is visible when the client has a service enabled that maps into an allowed unit', () => {
  const context = {
    crm_organisation_id: null,
    client_organization_id: 'c1',
    client_settings: { services: ['pulse'] }, // pulse -> Rhythm Engine
  };
  assert.equal(contactVisibleToBusinessUnits(context, ['Outlier Skate']), false);
  assert.equal(contactVisibleToBusinessUnits(context, ['Rhythm Engine']), true);
});

test('missing context (contact deleted or not found) is never visible under a real scope', () => {
  assert.equal(contactVisibleToBusinessUnits(null, ['Rhythm Engine']), false);
});
