import test from 'node:test';
import assert from 'node:assert/strict';
import { monthBoundsUtc, previousCompletedMonthIso } from './assessmentReconciliation.js';

test('monthBoundsUtc returns half-open [from, to) at UTC midnight', () => {
  const { from, to } = monthBoundsUtc('2026-04');
  assert.equal(from.toISOString(), '2026-04-01T00:00:00.000Z');
  assert.equal(to.toISOString(), '2026-05-01T00:00:00.000Z');
});

test('monthBoundsUtc rolls year boundary correctly for December', () => {
  const { from, to } = monthBoundsUtc('2026-12');
  assert.equal(from.toISOString(), '2026-12-01T00:00:00.000Z');
  assert.equal(to.toISOString(), '2027-01-01T00:00:00.000Z');
});

test('monthBoundsUtc throws on malformed input', () => {
  assert.throws(() => monthBoundsUtc('2026/04'), /YYYY-MM/);
  assert.throws(() => monthBoundsUtc(null), /YYYY-MM/);
});

test('monthBoundsUtc rejects month values outside 1-12', () => {
  assert.throws(() => monthBoundsUtc('2026-00'), /out of range/);
  assert.throws(() => monthBoundsUtc('2026-13'), /out of range/);
});

test('previousCompletedMonthIso returns the prior month for mid-month "now"', () => {
  const now = new Date('2026-05-15T12:00:00.000Z');
  assert.equal(previousCompletedMonthIso(now), '2026-04');
});

test('previousCompletedMonthIso returns the prior month when run on the 1st', () => {
  const now = new Date('2026-05-01T00:30:00.000Z');
  assert.equal(previousCompletedMonthIso(now), '2026-04');
});

test('previousCompletedMonthIso wraps to December of the prior year in January', () => {
  const now = new Date('2026-01-05T12:00:00.000Z');
  assert.equal(previousCompletedMonthIso(now), '2025-12');
});
