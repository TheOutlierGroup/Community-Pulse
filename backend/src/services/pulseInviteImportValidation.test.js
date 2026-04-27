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
  assert.equal(normalizeSurveyRoleFromImport('yes'), 'manager');
  assert.equal(normalizeSurveyRoleFromImport('no'), 'staff');
  assert.equal(normalizeSurveyRoleFromImport(''), 'staff');
  assert.equal(normalizeSurveyRoleFromImport('something-else'), null);
});

test('normalizeInviteImportRecipients uses manager yes/no field when provided', () => {
  const rows = normalizeInviteImportRecipients([
    { email: 'a@example.com', manager: 'yes' },
    { email: 'b@example.com', manager: 'no' },
  ]);
  assert.equal(rows[0].surveyRole, 'manager');
  assert.equal(rows[1].surveyRole, 'staff');
});

test('normalizeInviteImportRecipients prioritizes manager yes/no over role', () => {
  const rows = normalizeInviteImportRecipients([
    { email: 'a@example.com', role: 'staff', manager: 'yes' },
    { email: 'b@example.com', role: 'manager', manager: 'no' },
  ]);
  assert.equal(rows[0].surveyRole, 'manager');
  assert.equal(rows[1].surveyRole, 'staff');
});

test('normalizeInviteImportRecipients treats "faulse" manager value as staff', () => {
  const rows = normalizeInviteImportRecipients([
    { email: 'sam@example.com', manager: 'faulse' },
  ]);
  assert.equal(rows[0].surveyRole, 'staff');
});

test('validateInviteImportRows allows multiple managers to reference the same manager email', () => {
  const rows = normalizeInviteImportRecipients([
    { email: 'head@example.com', role: 'manager' },
    { email: 'm1@example.com', role: 'manager', managerId: 'head@example.com' },
    { email: 'm2@example.com', role: 'manager', managerId: 'head@example.com' },
  ]);
  const { errors } = validateInviteImportRows(rows, new Map());
  assert.equal(errors.length, 0);
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

test('validateInviteImportRows accepts staff manager email mapped to manager row in same import', () => {
  const rows = normalizeInviteImportRecipients([
    { email: 'boss@example.com', role: 'manager' },
    { email: 'staff@example.com', role: 'staff', managerId: 'boss@example.com' },
  ]);
  const { errors } = validateInviteImportRows(rows, new Map());
  assert.equal(errors.length, 0);
});

test('validateInviteImportRows allows staff to reference a manager listed later in CSV', () => {
  const rows = normalizeInviteImportRecipients([
    { email: 'staff@example.com', role: 'staff', managerId: 'boss@example.com' },
    { email: 'boss@example.com', role: 'manager' },
  ]);
  const { errors } = validateInviteImportRows(rows, new Map());
  assert.equal(errors.length, 0);
});

test('normalizeInviteImportRecipients normalizes group values to max 5 entries', () => {
  const rows = normalizeInviteImportRecipients([
    {
      email: 'staff@example.com',
      groupValues: [' Department ', '', null, ' Team ', 'Pod', 'Ignored'],
    },
  ]);
  assert.deepEqual(rows[0].groupValues, ['Department', null, null, 'Team', 'Pod']);
});

test('validateInviteImportRows pads group values when expectedGroupLevels configured', () => {
  const rows = normalizeInviteImportRecipients([
    { email: 'boss@example.com', role: 'manager', groupValues: ['Leadership'] },
    { email: 'staff@example.com', role: 'staff', managerId: 'boss@example.com', groupValues: ['Engineering', 'Mobile'] },
  ]);
  const { errors } = validateInviteImportRows(rows, new Map(), { expectedGroupLevels: 3 });
  assert.equal(errors.length, 0);
  assert.deepEqual(rows[0].groupValues, ['Leadership', null, null]);
  assert.deepEqual(rows[1].groupValues, ['Engineering', 'Mobile', null]);
});

test('validateInviteImportRows rejects rows with too many group values', () => {
  const rows = normalizeInviteImportRecipients([
    { email: 'boss@example.com', role: 'manager', groupValues: ['A', 'B', 'C'] },
  ]);
  const { errors } = validateInviteImportRows(rows, new Map(), { expectedGroupLevels: 2 });
  assert.equal(errors[0]?.error, 'invalid_group_levels');
  assert.equal(errors[0]?.expected, 2);
  assert.equal(errors[0]?.actual, 3);
});

test('validateInviteImportRows keeps partial-success shape with mixed valid and invalid dynamic rows', () => {
  const rows = normalizeInviteImportRecipients([
    { email: 'boss@example.com', role: 'manager', groupValues: ['Leadership'] },
    { email: 'staff-valid@example.com', role: 'staff', managerId: 'boss@example.com', groupValues: ['Engineering'] },
    { email: 'staff-invalid@example.com', role: 'staff', managerId: 'boss@example.com', groupValues: ['A', 'B', 'C'] },
  ]);
  const { errors, invalidIndices } = validateInviteImportRows(rows, new Map(), { expectedGroupLevels: 2 });

  assert.equal(errors.length, 1);
  assert.equal(errors[0]?.error, 'invalid_group_levels');
  assert.deepEqual([...invalidIndices].sort((a, b) => a - b), [2]);
  assert.deepEqual(rows[0].groupValues, ['Leadership', null]);
  assert.deepEqual(rows[1].groupValues, ['Engineering', null]);
});
