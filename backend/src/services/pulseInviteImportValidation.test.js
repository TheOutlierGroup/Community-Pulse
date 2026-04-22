import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeInviteImportRecipients,
  normalizeSurveyRoleFromImport,
  validateInviteImportRows,
} from './pulseInviteImportValidation.js';

test('normalizeSurveyRoleFromImport maps expected role strings', () => {
  assert.equal(normalizeSurveyRoleFromImport('manager'), 'manager');
  assert.equal(normalizeSurveyRoleFromImport('employee'), 'staff');
  assert.equal(normalizeSurveyRoleFromImport(''), 'staff');
  assert.equal(normalizeSurveyRoleFromImport('something-else'), null);
});

test('validateInviteImportRows flags duplicate manager_id for manager rows', () => {
  const rows = normalizeInviteImportRecipients([
    { email: 'm1@example.com', role: 'manager', managerId: 'mgr-1' },
    { email: 'm2@example.com', role: 'manager', managerId: 'mgr-1' },
  ]);
  const { errors } = validateInviteImportRows(rows, new Map());
  assert.equal(errors.filter((e) => e.error === 'duplicate_manager_id').length, 2);
});

test('validateInviteImportRows requires manager reference for staff rows', () => {
  const rows = normalizeInviteImportRecipients([
    { email: 'staff@example.com', role: 'staff' },
  ]);
  const { errors } = validateInviteImportRows(rows, new Map());
  assert.equal(errors[0]?.error, 'manager_required');
});

test('validateInviteImportRows allows unassigned staff when explicitly enabled', () => {
  const rows = normalizeInviteImportRecipients([
    { email: 'staff@example.com', role: 'staff' },
  ]);
  const { errors } = validateInviteImportRows(rows, new Map(), {
    allowStaffWithoutManagerRef: true,
  });
  assert.equal(errors.length, 0);
});

test('validateInviteImportRows allows valid existing managerInviteId', () => {
  const rows = normalizeInviteImportRecipients([
    { email: 'staff@example.com', role: 'staff', managerInviteId: 'manager-1' },
  ]);
  const existing = new Map([
    ['manager-1', { id: 'manager-1', survey_role: 'manager' }],
  ]);
  const { errors } = validateInviteImportRows(rows, existing);
  assert.equal(errors.length, 0);
});

test('validateInviteImportRows rejects non-manager managerInviteId', () => {
  const rows = normalizeInviteImportRecipients([
    { email: 'staff@example.com', role: 'staff', managerInviteId: 'not-manager' },
  ]);
  const existing = new Map([
    ['not-manager', { id: 'not-manager', survey_role: 'staff' }],
  ]);
  const { errors } = validateInviteImportRows(rows, existing);
  assert.equal(errors[0]?.error, 'invalid_manager_invite');
});

test('validateInviteImportRows accepts staff manager_id mapped to manager row in same import', () => {
  const rows = normalizeInviteImportRecipients([
    { email: 'boss@example.com', role: 'manager', managerId: 'mgr-100' },
    { email: 'staff@example.com', role: 'staff', managerId: 'mgr-100' },
  ]);
  const { errors } = validateInviteImportRows(rows, new Map());
  assert.equal(errors.length, 0);
});
