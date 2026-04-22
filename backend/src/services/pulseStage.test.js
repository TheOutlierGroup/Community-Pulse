import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizePulseStage,
  pulseStageToInternalTimepoint,
  internalTimepointToPulseStage,
  parsePulseStageFromRequest,
  PULSE_STAGE_PRE,
  PULSE_STAGE_MID,
  PULSE_STAGE_POST,
} from './pulseStage.js';

test('normalizePulseStage maps aliases and defaults safely', () => {
  assert.equal(normalizePulseStage('pre'), PULSE_STAGE_PRE);
  assert.equal(normalizePulseStage('during'), PULSE_STAGE_MID);
  assert.equal(normalizePulseStage('completed'), PULSE_STAGE_POST);
  assert.equal(normalizePulseStage('unknown'), PULSE_STAGE_PRE);
  assert.equal(normalizePulseStage('', PULSE_STAGE_POST), PULSE_STAGE_POST);
});

test('pulseStage internal mapping is stable', () => {
  assert.equal(pulseStageToInternalTimepoint('pre'), 'pre');
  assert.equal(pulseStageToInternalTimepoint('mid'), 'during');
  assert.equal(pulseStageToInternalTimepoint('post'), 'completed');
});

test('internal stage maps back to canonical pulse stage', () => {
  assert.equal(internalTimepointToPulseStage('pre'), PULSE_STAGE_PRE);
  assert.equal(internalTimepointToPulseStage('during'), PULSE_STAGE_MID);
  assert.equal(internalTimepointToPulseStage('completed'), PULSE_STAGE_POST);
});

test('parsePulseStageFromRequest checks params, query, then body', () => {
  assert.equal(parsePulseStageFromRequest({ params: { stage: 'mid' }, query: {}, body: {} }), PULSE_STAGE_MID);
  assert.equal(
    parsePulseStageFromRequest({ params: {}, query: { stage: 'post' }, body: {} }),
    PULSE_STAGE_POST
  );
  assert.equal(parsePulseStageFromRequest({ params: {}, query: {}, body: { stage: 'pre' } }), PULSE_STAGE_PRE);
});
