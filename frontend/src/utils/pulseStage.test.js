import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizePulseStage,
  PULSE_STAGE_PRE,
  PULSE_STAGE_MID,
  PULSE_STAGE_POST,
} from './pulseStage.js';

test('frontend normalizePulseStage supports canonical values and aliases', () => {
  assert.equal(normalizePulseStage('pre'), PULSE_STAGE_PRE);
  assert.equal(normalizePulseStage('mid'), PULSE_STAGE_MID);
  assert.equal(normalizePulseStage('post'), PULSE_STAGE_POST);
  assert.equal(normalizePulseStage('during'), PULSE_STAGE_MID);
  assert.equal(normalizePulseStage('completed'), PULSE_STAGE_POST);
});

test('frontend normalizePulseStage falls back to provided default', () => {
  assert.equal(normalizePulseStage('unknown'), PULSE_STAGE_PRE);
  assert.equal(normalizePulseStage('unknown', PULSE_STAGE_POST), PULSE_STAGE_POST);
});
