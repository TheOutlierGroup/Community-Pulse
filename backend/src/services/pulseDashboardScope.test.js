import test from 'node:test';
import assert from 'node:assert/strict';
import {
  filterRowsForManagerScope,
  parseManagerIdsFromQuery,
  parseQueryBool,
} from './pulseDashboardScope.js';

test('parseManagerIdsFromQuery handles comma-separated and repeated values', () => {
  const ids = parseManagerIdsFromQuery({
    managerIds: ['m1,m2', 'm2', '  ', 'm3'],
  });
  assert.deepEqual(ids, ['m1', 'm2', 'm3']);
});

test('parseQueryBool supports true/false string and numeric flags', () => {
  assert.equal(parseQueryBool('true', false), true);
  assert.equal(parseQueryBool('1', false), true);
  assert.equal(parseQueryBool('false', true), false);
  assert.equal(parseQueryBool('0', true), false);
  assert.equal(parseQueryBool('other', true), true);
});

test('filterRowsForManagerScope keeps only direct reports when include self is false', () => {
  const rows = [
    { id: 'r1', role: 'employee', manager_invite_id: 'm1', invite_id: null, user_id: null },
    { id: 'r2', role: 'employee', manager_invite_id: 'm2', invite_id: null, user_id: null },
    { id: 'r3', role: 'admin', manager_invite_id: null, invite_id: 'm1', user_id: null },
  ];
  const filtered = filterRowsForManagerScope(rows, new Set(['m1']), false);
  assert.deepEqual(
    filtered.map((r) => r.id),
    ['r1']
  );
});

test('filterRowsForManagerScope includes manager self rows when enabled', () => {
  const rows = [
    { id: 'r1', role: 'employee', manager_invite_id: 'm1', invite_id: null, user_id: null },
    { id: 'r2', role: 'admin', manager_invite_id: null, invite_id: 'm1', user_id: null },
    { id: 'r3', role: 'employee', manager_invite_id: 'm2', invite_id: null, user_id: null },
  ];
  const filtered = filterRowsForManagerScope(rows, new Set(['m1']), true);
  assert.deepEqual(
    filtered.map((r) => r.id),
    ['r1', 'r2']
  );
});
