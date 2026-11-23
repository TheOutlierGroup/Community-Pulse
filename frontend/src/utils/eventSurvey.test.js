import test from 'node:test';
import assert from 'node:assert/strict';
import { eventSectionHeading, eventProgressPercent, minutesLeft } from './eventSurvey.js';

test('section heading shows section, question range and time left', () => {
  assert.equal(
    eventSectionHeading(1),
    '**Section 1 of 4** · Questions 1 to 4 of 16 · about 5 minutes left'
  );
  assert.equal(
    eventSectionHeading(2),
    '**Section 2 of 4** · Questions 5 to 8 of 16 · about 4 minutes left'
  );
  assert.equal(
    eventSectionHeading(4),
    '**Section 4 of 4** · Questions 13 to 16 of 16 · about 1 minute left'
  );
});

test('minutes left never drops below 1', () => {
  assert.equal(minutesLeft(4), 1);
  assert.equal(minutesLeft(9), 1);
});

test('progress fills by section', () => {
  assert.equal(eventProgressPercent(1), 0);
  assert.equal(eventProgressPercent(3), 50);
  assert.equal(eventProgressPercent(5), 100);
});
