import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CLIENT_SERVICE_OTHER,
  CLIENT_SERVICE_PULSE,
  clientServiceCatalogFromPlatformSettings,
  enabledServicesFromOrganizationSettings,
  normalizeClientServiceCatalog,
  normalizeClientServiceIds,
  normalizeOrganizationSettings,
  organizationHasService,
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
    { id: 'other', name: 'Other' },
  ]);
});

