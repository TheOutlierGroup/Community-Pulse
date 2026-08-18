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
    'employee preferred first name,email address,Manager Email',
    'Olivia,olivia@example.com,',
    'Noah,noah@example.com,olivia@example.com',
    'Ava,ava@example.com,',
    'Liam,liam@example.com,ava@example.com',
  ].join('\n');

  const rows = parseRecipientCsv(csv);
  assert.equal(rows.length, 4);

  assert.equal(rows[0].role, 'manager');
  assert.equal(rows[0].managerId, undefined);
  assert.equal(rows[1].role, 'staff');
  assert.equal(rows[1].managerId, 'olivia@example.com');

  assert.equal(rows[2].role, 'manager');
  assert.equal(rows[2].managerId, undefined);
  assert.equal(rows[3].role, 'staff');
  assert.equal(rows[3].managerId, 'ava@example.com');
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
    'employee preferred first name,email address,Manager Email',
    'Solo Lead,solo.lead@example.com,',
  ].join('\n');

  const rows = parseRecipientCsv(csv, { ambiguousBlankManagerRole: 'manager' });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].role, 'manager');
  assert.equal(rows[0].managerId, undefined);
});

test('parseRecipientCsv supports Manager yes/no column for survey role mapping', () => {
  const csv = [
    'name,email,Manager,Manager Email',
    'Olivia,olivia@example.com,Yes,',
    'Noah,noah@example.com,No,olivia@example.com',
  ].join('\n');

  const rows = parseRecipientCsv(csv);
  assert.equal(rows.length, 2);

  assert.equal(rows[0].role, 'manager');
  assert.equal(rows[0].managerId, undefined);

  assert.equal(rows[1].role, 'staff');
  assert.equal(rows[1].managerId, 'olivia@example.com');
});

test('parseRecipientCsv supports manager flag headers with slash spacing', () => {
  const csv = [
    'name,email,Manager (Yes / No),Manager Email',
    'Olivia,olivia@example.com,Yes,',
    'Noah,noah@example.com,No,olivia@example.com',
  ].join('\n');

  const rows = parseRecipientCsv(csv);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].role, 'manager');
  assert.equal(rows[0].managerId, undefined);
  assert.equal(rows[1].role, 'staff');
  assert.equal(rows[1].managerId, 'olivia@example.com');
});

test('parseRecipientCsv prioritizes Manager yes/no over role when both are present', () => {
  const csv = [
    'name,email,role,Manager,Manager Email',
    'Taylor,taylor@example.com,staff,Yes,',
    'Jordan,jordan@example.com,manager,No,taylor@example.com',
  ].join('\n');

  const rows = parseRecipientCsv(csv);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].role, 'manager');
  assert.equal(rows[1].role, 'staff');
});

test('parseRecipientCsv treats "faulse" manager flag as staff', () => {
  const csv = [
    'name,email,Manager',
    'Sam,sam@example.com,faulse',
  ].join('\n');

  const rows = parseRecipientCsv(csv);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].role, 'staff');
});

// D-010: a CSV with separate First Name / Last Name columns (common in real
// HR exports, and the fixture used for REA-03) had no recognised "name"
// column at all, so colName stayed -1 for every row and the
// em.split('@')[0] fallback silently substituted the email's local part as
// everyone's name.
test('parseRecipientCsv combines separate First Name and Last Name columns', () => {
  const csv = [
    'First Name,Last Name,Email Address,Manager (Yes/No)',
    'Jane,Doe,jane.doe@example.com,No',
  ].join('\n');

  const rows = parseRecipientCsv(csv);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'Jane Doe');
  assert.equal(rows[0].email, 'jane.doe@example.com');
});

test('parseRecipientCsv falls back to the email prefix only when no name column exists at all', () => {
  const csv = [
    'Email Address,Manager (Yes/No)',
    'jane.doe@example.com,No',
  ].join('\n');

  const rows = parseRecipientCsv(csv);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'jane.doe');
});

test('parseRecipientCsv handles a First Name column with no Last Name column', () => {
  const csv = [
    'First Name,Email',
    'Madonna,madonna@example.com',
  ].join('\n');

  const rows = parseRecipientCsv(csv);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'Madonna');
});

test('parseRecipientCsv recognizes the server-generated template header verbatim', () => {
  // Mirrors buildClientUserImportTemplateCsv's fixed header order in
  // backend/src/routes/platform/orgRoutes.js.
  const csv = [
    'employee full name,email address,employent type (FT/PT/Casual),Manager (Yes/No),Manager Email,birth year,Length of Service,Primary Work Location,Business Unit,Division,Team',
    'Jane Doe,jane.doe@example.com,FT,No,john.manager@example.com,1990,2 years,Sydney,Sales,APAC,Team A',
  ].join('\n');

  const rows = parseRecipientCsv(csv, { groupLabels: ['Business Unit', 'Division', 'Team'] });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'Jane Doe');
  assert.equal(rows[0].email, 'jane.doe@example.com');
  assert.deepEqual(rows[0].groupValues, ['Sales', 'APAC', 'Team A']);
});
