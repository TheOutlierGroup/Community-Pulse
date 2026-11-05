import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCrossStageDivergenceFlags, describeDivergenceEmptyState } from './crossStageDivergence.js';

function stage(key, label, employee = null, manager = null) {
  const fill = (value) => Object.fromEntries(['1A', '1B', '1C', '1D', '2A', '2B', '2C', '2D'].map((id) => [id, value]));
  return {
    key,
    label,
    available: employee != null || manager != null,
    dimensions: { employee: employee == null ? {} : fill(employee), manager: manager == null ? {} : fill(manager) },
  };
}

// RED-046: the defect's own scenario, one checkpoint with data.
test('one checkpoint with results explains there is nothing to compare yet', () => {
  const stages = [stage('pre', 'Pre', 3.2, 3.4), stage('during', 'During'), stage('post', 'Post')];
  const flags = buildCrossStageDivergenceFlags(stages);
  assert.equal(flags.length, 0);
  const state = describeDivergenceEmptyState(stages, flags);
  assert.equal(state.reason, 'single-stage');
  assert.match(state.message, /only Pre has results so far/);
  assert.doesNotMatch(state.message, /within expected variation/);
});

test('no checkpoint with results says so', () => {
  const stages = [stage('pre', 'Pre'), stage('during', 'During'), stage('post', 'Post')];
  assert.equal(describeDivergenceEmptyState(stages, []).reason, 'no-data');
});

test('a stage that loaded but had every score withheld does not count as having results', () => {
  const stages = [stage('pre', 'Pre', 3.2), { ...stage('during', 'During'), available: true }, stage('post', 'Post')];
  assert.equal(describeDivergenceEmptyState(stages, []).reason, 'single-stage');
});

test('checkpoints that cannot be compared consecutively are explained, not reported as stable', () => {
  const stages = [stage('pre', 'Pre', 3.2), stage('during', 'During'), stage('post', 'Post', 3.3)];
  const state = describeDivergenceEmptyState(stages, buildCrossStageDivergenceFlags(stages));
  assert.equal(state.reason, 'not-comparable');
  assert.match(state.message, /Pre and Post have results/);
});

test('real comparisons with small movement keep the within-range message', () => {
  const stages = [stage('pre', 'Pre', 3.2, 3.0), stage('during', 'During', 3.6, 3.5), stage('post', 'Post')];
  const flags = buildCrossStageDivergenceFlags(stages);
  assert.equal(flags.length, 0);
  assert.equal(describeDivergenceEmptyState(stages, flags).reason, 'within-range');
});

test('movements of 1.0 or more are flagged and the empty state is not used', () => {
  const stages = [stage('pre', 'Pre', 2.0, 3.0), stage('during', 'During', 3.5, 3.2), stage('post', 'Post')];
  const flags = buildCrossStageDivergenceFlags(stages);
  assert.equal(flags.length, 8);
  assert.ok(flags.every((flag) => flag.survey === 'Employee' && flag.delta === 1.5));
  assert.equal(describeDivergenceEmptyState(stages, flags), null);
});
