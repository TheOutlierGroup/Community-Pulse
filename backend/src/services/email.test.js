import test from 'node:test';
import assert from 'node:assert/strict';
import { formatDueDateForEmail, getPulseInviteDefaultTemplate } from './email.js';

// D-020: with no due date configured for an org/timepoint, the invite
// email's {{dueDate}} token substituted to an empty string, so the sent
// copy read "your response is needed by ." with nothing after "by".

test('formatDueDateForEmail renders a configured date in Australian format', () => {
  assert.equal(formatDueDateForEmail('2026-08-20'), '20 Aug 2026');
});

test('formatDueDateForEmail falls back to a real date, not blank, for an empty value', () => {
  const result = formatDueDateForEmail('');
  assert.notEqual(result, '');
  assert.match(result, /^\d{1,2} \w{3} \d{4}$/);
});

test('formatDueDateForEmail falls back to a real date, not blank, for a malformed value', () => {
  const result = formatDueDateForEmail('not-a-date');
  assert.notEqual(result, '');
  assert.match(result, /^\d{1,2} \w{3} \d{4}$/);
});

test('formatDueDateForEmail defaults roughly 3 days ahead of send time', () => {
  const result = formatDueDateForEmail(null);
  const parsed = new Date(result);
  const expected = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
  const diffDays = Math.abs(parsed.getTime() - expected.getTime()) / (24 * 60 * 60 * 1000);
  assert.ok(diffDays < 1.5, `expected roughly 3 days out, got a ${diffDays.toFixed(2)}-day difference`);
});

// D-020 (RSP-01 notes): the invite email said 'If you have any questions,
// please contact [NAME/EMAIL]' -- a hand-typed placeholder no rendering
// path ever resolved. The default template now uses a real {{contactInfo}}
// token instead, which sendPulseInviteEmail's templateReplacements always
// resolves to something real.
test('getPulseInviteDefaultTemplate references contactInfo and dueDate tokens, not a dead bracket placeholder', () => {
  const staffTemplate = getPulseInviteDefaultTemplate('staff', 'Acme Co');
  assert.match(staffTemplate.bodyHtml, /\{\{contactInfo\}\}/);
  assert.match(staffTemplate.bodyHtml, /\{\{dueDate\}\}/);
  assert.doesNotMatch(staffTemplate.bodyHtml, /\[NAME\/EMAIL\]/i);

  const managerTemplate = getPulseInviteDefaultTemplate('manager', 'Acme Co');
  assert.match(managerTemplate.bodyHtml, /\{\{contactInfo\}\}/);
  assert.match(managerTemplate.bodyHtml, /\{\{dueDate\}\}/);
});
