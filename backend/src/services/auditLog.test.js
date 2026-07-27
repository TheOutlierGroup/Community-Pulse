import test from 'node:test';
import assert from 'node:assert/strict';
import { diffFields } from './auditLog.js';

test('diffFields reports only changed top-level fields', () => {
  const before = { name: 'Acme', status: 'active' };
  const after = { name: 'Acme Inc', status: 'active' };
  assert.deepEqual(diffFields(before, after, ['name', 'status']), {
    name: { from: 'Acme', to: 'Acme Inc' },
  });
});

test('diffFields supports dot-path nested fields', () => {
  const before = { settings: { groupLevels: 3, other: 'x' } };
  const after = { settings: { groupLevels: 4, other: 'x' } };
  assert.deepEqual(diffFields(before, after, ['settings.groupLevels', 'settings.other']), {
    'settings.groupLevels': { from: 3, to: 4 },
  });
});

test('diffFields treats undefined and null as equivalent', () => {
  const before = { notes: undefined };
  const after = { notes: null };
  assert.deepEqual(diffFields(before, after, ['notes']), {});
});

test('diffFields returns from/to as null when a field is missing entirely', () => {
  const before = {};
  const after = { name: 'New' };
  assert.deepEqual(diffFields(before, after, ['name']), {
    name: { from: null, to: 'New' },
  });
});

test('diffFields does array/object comparisons by value, not reference', () => {
  const before = { services: ['pulse', 'crm'] };
  const after = { services: ['pulse', 'crm'] };
  assert.deepEqual(diffFields(before, after, ['services']), {});
  const changed = { services: ['pulse'] };
  assert.deepEqual(diffFields(before, changed, ['services']), {
    services: { from: ['pulse', 'crm'], to: ['pulse'] },
  });
});
