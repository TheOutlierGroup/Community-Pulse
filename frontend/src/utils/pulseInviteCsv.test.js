import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRecipientCsv } from './pulseInviteCsv.js';

test('parseRecipientCsv maps dynamic group labels by header name', () => {
  const csv = [
    'name,email,role,manager_id,Department,Team',
    'Boss,boss@example.com,manager,mgr-1,Operations,Leadership',
    'Alex,alex@example.com,staff,mgr-1,Engineering,Platform',
  ].join('\n');

  const rows = parseRecipientCsv(csv, { groupLabels: ['Department', 'Team'] });
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0].groupValues, ['Operations', 'Leadership']);
  assert.deepEqual(rows[1].groupValues, ['Engineering', 'Platform']);
});

test('parseRecipientCsv supports alias headers and normalizes missing group values', () => {
  const csv = [
    'display name,email address,survey role,manager name,business unit,squad',
    'Taylor,taylor@example.com,staff,boss@example.com,Product,',
  ].join('\n');

  const rows = parseRecipientCsv(csv, { groupLabels: ['Business Unit', 'Squad'] });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].managerId, 'boss@example.com');
  assert.deepEqual(rows[0].groupValues, ['Product', null]);
});

test('parseRecipientCsv keeps legacy headerless format working', () => {
  const csv = [
    'legacy@example.com,Legacy User,staff,manager@example.com',
    'Invalid Row,not-an-email,staff,manager@example.com',
  ].join('\n');

  const rows = parseRecipientCsv(csv, { groupLabels: ['Department', 'Team'] });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].email, 'legacy@example.com');
  assert.equal(rows[0].managerId, 'manager@example.com');
  assert.equal(rows[0].groupValues, undefined);
});

test('parseRecipientCsv infers manager role from Manager Name references when role is missing', () => {
  const csv = [
    'employee preferred first name,email address,Manager Name',
    'Olivia,olivia@example.com,',
    'Noah,noah@example.com,Olivia',
    'Ava,ava@example.com,',
    'Liam,liam@example.com,Ava',
  ].join('\n');

  const rows = parseRecipientCsv(csv);
  assert.equal(rows.length, 4);

  assert.equal(rows[0].role, 'manager');
  assert.equal(rows[0].managerId, 'Olivia');
  assert.equal(rows[1].role, 'staff');
  assert.equal(rows[1].managerId, 'Olivia');

  assert.equal(rows[2].role, 'manager');
  assert.equal(rows[2].managerId, 'Ava');
  assert.equal(rows[3].role, 'staff');
  assert.equal(rows[3].managerId, 'Ava');
});

test('parseRecipientCsv defaults ambiguous blank-manager rows to staff', () => {
  const csv = [
    'employee preferred first name,email address,Manager Name',
    'Solo Lead,solo.lead@example.com,',
  ].join('\n');

  const rows = parseRecipientCsv(csv);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].role, 'staff');
  assert.equal(rows[0].managerId, undefined);
});

test('parseRecipientCsv can default ambiguous blank-manager rows to manager', () => {
  const csv = [
    'employee preferred first name,email address,Manager Name',
    'Solo Lead,solo.lead@example.com,',
  ].join('\n');

  const rows = parseRecipientCsv(csv, { ambiguousBlankManagerRole: 'manager' });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].role, 'manager');
  assert.equal(rows[0].managerId, 'Solo Lead');
});
