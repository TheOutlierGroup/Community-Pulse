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

import {
  answeredProgressPercent,
  minutesLeftForAnswers,
  readAnswerDraft,
  writeAnswerDraft,
  clearAnswerDraft,
} from './eventSurvey.js';

const Q = Array.from({ length: 16 }, (_, i) => ({ id: `Q${i + 1}` }));

test('progress follows answers, not sections', () => {
  assert.equal(answeredProgressPercent({}, Q), 0);
  assert.equal(answeredProgressPercent({ Q1: 3, Q2: 4 }, Q), 13);
  assert.equal(answeredProgressPercent(Object.fromEntries(Q.map((q) => [q.id, 3])), Q), 100);
});

test('minutes left counts down smoothly with answers', () => {
  assert.equal(minutesLeftForAnswers({}, Q), 5);
  assert.equal(minutesLeftForAnswers({ Q1: 1, Q2: 1, Q3: 1, Q4: 1 }, Q), 4);
  assert.equal(minutesLeftForAnswers(Object.fromEntries(Q.slice(0, 15).map((q) => [q.id, 2])), Q), 1);
});

test('drafts round-trip and ignore junk', () => {
  const store = new Map();
  const storage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, v),
    removeItem: (k) => store.delete(k),
  };
  writeAnswerDraft('k', { Q1: 4, MQ2: 5 }, storage);
  assert.deepEqual(readAnswerDraft('k', storage), { Q1: 4, MQ2: 5 });
  store.set('k', JSON.stringify({ Q1: 9, evil: 1, Q2: '3' }));
  assert.deepEqual(readAnswerDraft('k', storage), {});
  store.set('k', 'not json');
  assert.deepEqual(readAnswerDraft('k', storage), {});
  clearAnswerDraft('k', storage);
  assert.equal(store.has('k'), false);
  assert.deepEqual(readAnswerDraft('k', undefined), {});
});

test('drafts expire after 14 days and survive as a wrapped record', () => {
  const store = new Map();
  const storage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, v),
    removeItem: (k) => store.delete(k),
  };
  writeAnswerDraft('k', { Q3: 2 }, storage, 1000);
  assert.deepEqual(readAnswerDraft('k', storage, 2000), { Q3: 2 });
  assert.deepEqual(readAnswerDraft('k', storage, 1000 + 15 * 24 * 60 * 60 * 1000), {});
});
