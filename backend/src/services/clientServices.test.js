import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CLIENT_SERVICE_PULSE,
  enabledServicesFromOrganizationSettings,
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

test('normalizeClientServiceIds keeps only known unique ids', () => {
  assert.deepEqual(
    normalizeClientServiceIds(['pulse', 'PULSE', 'unknown', '', ' pulse ']),
    ['pulse']
  );
  assert.deepEqual(normalizeClientServiceIds('pulse'), []);
});

test('enabledServicesFromOrganizationSettings honors services array', () => {
  const enabled = enabledServicesFromOrganizationSettings({
    services: ['pulse', 'other', 'pulse'],
    pulseEnabled: false,
  });
  assert.deepEqual(enabled, [CLIENT_SERVICE_PULSE]);
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

