import test from 'node:test';
import assert from 'node:assert/strict';
import { claudeModelParams } from './claudeModelParams.js';

test('legacy models keep the requested temperature', () => {
  assert.deepEqual(claudeModelParams('claude-sonnet-4-20250514', { temperature: 0.3 }), {
    temperature: 0.3,
  });
  assert.deepEqual(claudeModelParams('claude-sonnet-4-20250514', { temperature: 0 }), {
    temperature: 0,
  });
});

test('Sonnet 5.5 omits temperature and turns thinking off between tools', () => {
  assert.deepEqual(claudeModelParams('claude-sonnet-5-5', { temperature: 0.3 }), {
    thinking: { type: 'between_tools' },
  });
});

test('other 5.x models omit temperature without a thinking override', () => {
  assert.deepEqual(claudeModelParams('claude-opus-5-5', { temperature: 0.3 }), {});
});
