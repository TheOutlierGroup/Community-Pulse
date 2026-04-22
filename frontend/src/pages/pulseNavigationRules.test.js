import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvePulseFocusedSection, trendAnalysisVisibleFromOptions } from './pulseNavigationRules.js';

test('trendAnalysisVisibleFromOptions requires at least two unique stage families', () => {
  assert.equal(trendAnalysisVisibleFromOptions([]), false);
  assert.equal(trendAnalysisVisibleFromOptions([{ phase: 'during' }, { phase: 'during' }]), false);
  assert.equal(trendAnalysisVisibleFromOptions([{ phase: 'pre' }, { phase: 'during' }]), true);
  assert.equal(trendAnalysisVisibleFromOptions([{ phase: 'pre' }, { phase: 'completed' }]), true);
  assert.equal(
    trendAnalysisVisibleFromOptions([{ phase: 'pre' }, { phase: 'during' }, { phase: 'completed' }]),
    true
  );
});

test('resolvePulseFocusedSection maps aliases and guards trend-analysis visibility', () => {
  assert.equal(resolvePulseFocusedSection('', false), null);
  assert.equal(resolvePulseFocusedSection('#organisation-dashboard', true), null);
  assert.equal(resolvePulseFocusedSection('#score-breakdown', true), 'employee-breakdown');
  assert.equal(resolvePulseFocusedSection('#manager-load-report', true), null);
  assert.equal(resolvePulseFocusedSection('#trend-analysis', false), null);
  assert.equal(resolvePulseFocusedSection('#trend-analysis', true), 'trend-analysis');
  assert.equal(resolvePulseFocusedSection('#team-level-view', true), 'team-level-view');
  assert.equal(resolvePulseFocusedSection('#reports', true), 'reports');
});
