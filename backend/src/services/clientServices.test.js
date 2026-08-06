import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CLIENT_SERVICE_OTHER,
  CLIENT_SERVICE_PROJECT_RESOURCES,
  CLIENT_SERVICE_PULSE,
  businessUnitsForEnabledServices,
  clientServiceCatalogFromPlatformSettings,
  enabledServicesFromOrganizationSettings,
  normalizeClientServiceCatalog,
  normalizeClientServiceIds,
  normalizeOrganizationSettings,
  organizationHasService,
  organizationVisibleToBusinessUnits,
} from './clientServices.js';

test('normalizeOrganizationSettings handles object, json string, and invalid input', () => {
  assert.deepEqual(normalizeOrganizationSettings({ a: 1 }), { a: 1 });
  assert.deepEqual(normalizeOrganizationSettings('{"services":["pulse"]}'), {
    services: ['pulse'],
  });
  assert.deepEqual(normalizeOrganizationSettings('not json'), {});
  assert.deepEqual(normalizeOrganizationSettings(null), {});
});

test('normalizeClientServiceIds keeps normalized unique ids', () => {
  assert.deepEqual(
    normalizeClientServiceIds(['pulse', 'PULSE', 'unknown', '', ' pulse ']),
    ['pulse', 'unknown']
  );
  assert.deepEqual(normalizeClientServiceIds('pulse'), []);
});

test('enabledServicesFromOrganizationSettings honors services array', () => {
  const enabled = enabledServicesFromOrganizationSettings({
    services: ['pulse', 'other', 'pulse'],
    pulseEnabled: false,
  });
  assert.deepEqual(enabled, [CLIENT_SERVICE_PULSE, CLIENT_SERVICE_OTHER]);
});

test('enabledServicesFromOrganizationSettings falls back to legacy pulseEnabled', () => {
  const enabled = enabledServicesFromOrganizationSettings({ pulseEnabled: true });
  assert.deepEqual(enabled, [CLIENT_SERVICE_PULSE]);
});

test('enabledServicesFromOrganizationSettings treats explicit services as source of truth', () => {
  const enabled = enabledServicesFromOrganizationSettings({
    services: [],
    pulseEnabled: true,
  });
  assert.deepEqual(enabled, []);
});

test('organizationHasService checks normalized service list', () => {
  assert.equal(organizationHasService({ services: ['pulse'] }, 'pulse'), true);
  assert.equal(organizationHasService({ services: ['pulse'] }, 'PULSE'), true);
  assert.equal(organizationHasService({ services: [] }, 'pulse'), false);
  assert.equal(organizationHasService({ pulseEnabled: true }, 'pulse'), true);
  assert.equal(
    organizationHasService({ services: [], pulseEnabled: true }, 'pulse'),
    false
  );
});

test('normalizeClientServiceCatalog assigns ids and dedupes', () => {
  assert.deepEqual(
    normalizeClientServiceCatalog([
      { name: 'Managed AI' },
      { id: 'managed-ai', name: 'Managed AI Duplicate' },
      { id: 'Pulse', name: 'Rhythm Engine' },
    ], { fallbackToDefaults: false }),
    [
      { id: 'pulse', name: 'Rhythm Engine' },
      { id: 'rhythm-engine-licensee', name: 'Rhythm Engine Licensee' },
      { id: 'other', name: 'Other' },
      { id: 'managed-ai', name: 'Managed AI' },
      { id: 'managed-ai-2', name: 'Managed AI Duplicate' },
    ]
  );
});

test('clientServiceCatalogFromPlatformSettings falls back to defaults', () => {
  const fromEmpty = clientServiceCatalogFromPlatformSettings({});
  assert.equal(Array.isArray(fromEmpty), true);
  assert.equal(fromEmpty.length > 0, true);
  assert.deepEqual(clientServiceCatalogFromPlatformSettings({ serviceCatalog: [] }), [
    { id: 'pulse', name: 'Rhythm Engine' },
    { id: 'rhythm-engine-licensee', name: 'Rhythm Engine Licensee' },
    { id: 'other', name: 'Other' },
  ]);
});

// D-014: Other and Project Resources had no Business Unit mapping at all,
// so "Outlier Core" -- a real, assignable BU tag, and the default
// business_unit for a new Prospect -- had no client service that could
// ever map into it. A Basic-tier user scoped only to Outlier Core could
// never see any client through this mechanism, and a client whose only
// service was Project Resources was invisible to every BU tag.
test('Other and Project Resources map to Outlier Core', () => {
  assert.deepEqual(businessUnitsForEnabledServices([CLIENT_SERVICE_OTHER]), ['Outlier Core']);
  assert.deepEqual(businessUnitsForEnabledServices([CLIENT_SERVICE_PROJECT_RESOURCES]), ['Outlier Core']);
});

test('a client whose only service is Project Resources is visible to an Outlier Core scoped user', () => {
  const settings = { services: [CLIENT_SERVICE_PROJECT_RESOURCES] };
  assert.equal(organizationVisibleToBusinessUnits(settings, ['Outlier Core']), true);
  assert.equal(organizationVisibleToBusinessUnits(settings, ['Rhythm Engine']), false);
});

// A client with multiple services is fully visible (not partially hidden)
// as soon as any one of them maps into the caller's scope -- the caller
// shouldn't need every service to match to see the client at all.
test('a client with multiple services is visible on a single matching service', () => {
  const settings = { services: [CLIENT_SERVICE_PULSE, CLIENT_SERVICE_PROJECT_RESOURCES] };
  assert.equal(organizationVisibleToBusinessUnits(settings, ['Rhythm Engine']), true);
  assert.equal(organizationVisibleToBusinessUnits(settings, ['Outlier Core']), true);
  assert.equal(organizationVisibleToBusinessUnits(settings, ['ET Inc']), false);
});

