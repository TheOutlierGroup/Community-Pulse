import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SURVEY_SCALE,
  missingQuestionIds,
  missingAnswersMessage,
  parseEmphasis,
  stripEmphasis,
} from './surveyText.js';

test('scale uses sentence case and the full midpoint label', () => {
  assert.deepEqual(
    SURVEY_SCALE.map((s) => s.label),
    ['Strongly disagree', 'Disagree', 'Neither agree nor disagree', 'Agree', 'Strongly agree']
  );
});

test('missingQuestionIds lists unanswered ids in order', () => {
  const questions = [{ id: 'Q1' }, { id: 'Q2' }, { id: 'Q3' }];
  assert.deepEqual(missingQuestionIds(questions, { Q2: 4 }), ['Q1', 'Q3']);
  assert.deepEqual(missingQuestionIds(questions, { Q1: 1, Q2: 2, Q3: 3 }), []);
  assert.deepEqual(missingQuestionIds(null, null), []);
});

test('missingAnswersMessage handles singular and plural', () => {
  assert.equal(missingAnswersMessage(0), '');
  assert.equal(missingAnswersMessage(1), '1 statement still needs an answer.');
  assert.equal(missingAnswersMessage(3), '3 statements still need an answer.');
});

test('parseEmphasis splits bold runs and keeps plain text', () => {
  assert.deepEqual(parseEmphasis('I have **the time** to learn.'), [
    { text: 'I have ', bold: false },
    { text: 'the time', bold: true },
    { text: ' to learn.', bold: false },
  ]);
  assert.deepEqual(parseEmphasis('No markers here.'), [{ text: 'No markers here.', bold: false }]);
  assert.deepEqual(parseEmphasis('**All bold**'), [{ text: 'All bold', bold: true }]);
});

test('parseEmphasis leaves an unmatched marker as literal text', () => {
  assert.deepEqual(parseEmphasis('Half **open'), [{ text: 'Half **open', bold: false }]);
});

test('parseEmphasis never produces HTML', () => {
  const parts = parseEmphasis('**<img src=x onerror=alert(1)>**');
  assert.equal(parts[0].text, '<img src=x onerror=alert(1)>');
  assert.equal(parts[0].bold, true);
});

test('stripEmphasis removes markers', () => {
  assert.equal(stripEmphasis('I have **the time** to learn.'), 'I have the time to learn.');
});
