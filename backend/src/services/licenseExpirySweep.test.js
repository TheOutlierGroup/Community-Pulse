import test from 'node:test';
import assert from 'node:assert/strict';
import { bucketDaysUntil, getDefaultThresholdDays } from './licenseExpirySweep.js';

const NOW = new Date('2026-05-05T00:00:00.000Z');

test('bucketDaysUntil returns null for missing or invalid contract end', () => {
  assert.equal(bucketDaysUntil(null, NOW), null);
  assert.equal(bucketDaysUntil('not-a-date', NOW), null);
});

test('bucketDaysUntil rounds future contract ends UP so 13d 12h triggers the 14-day bucket', () => {
  const future = new Date(NOW.getTime() + (13.5 * 24 * 60 * 60 * 1000)).toISOString();
  assert.equal(bucketDaysUntil(future, NOW), 14);
});

test('bucketDaysUntil returns 1 for a contract end ~24 hours away', () => {
  const inOneDay = new Date(NOW.getTime() + (23 * 60 * 60 * 1000)).toISOString();
  assert.equal(bucketDaysUntil(inOneDay, NOW), 1);
});

test('bucketDaysUntil returns 0 for a contract end that already passed today', () => {
  const justExpired = new Date(NOW.getTime() - (60 * 60 * 1000)).toISOString();
  assert.equal(bucketDaysUntil(justExpired, NOW), 0);
});

test('bucketDaysUntil returns 0 for any contract end up to 30 days in the past', () => {
  const longExpired = new Date(NOW.getTime() - (29 * 24 * 60 * 60 * 1000)).toISOString();
  assert.equal(bucketDaysUntil(longExpired, NOW), 0);
});

test('bucketDaysUntil returns null once we are more than 30 days past expiry', () => {
  const tooLongExpired = new Date(NOW.getTime() - (31 * 24 * 60 * 60 * 1000)).toISOString();
  assert.equal(bucketDaysUntil(tooLongExpired, NOW), null);
});

test('getDefaultThresholdDays returns the documented default ladder when env not set', () => {
  const original = process.env.LICENCE_EXPIRY_THRESHOLDS;
  delete process.env.LICENCE_EXPIRY_THRESHOLDS;
  try {
    assert.deepEqual(getDefaultThresholdDays(), [30, 14, 7, 1, 0]);
  } finally {
    if (original !== undefined) process.env.LICENCE_EXPIRY_THRESHOLDS = original;
  }
});

test('getDefaultThresholdDays parses a comma-separated env override (sorted desc, deduped)', () => {
  const original = process.env.LICENCE_EXPIRY_THRESHOLDS;
  process.env.LICENCE_EXPIRY_THRESHOLDS = '7, 30, 7, 1';
  try {
    assert.deepEqual(getDefaultThresholdDays(), [30, 7, 1]);
  } finally {
    if (original === undefined) delete process.env.LICENCE_EXPIRY_THRESHOLDS;
    else process.env.LICENCE_EXPIRY_THRESHOLDS = original;
  }
});

test('getDefaultThresholdDays falls back to defaults when env override is unparsable', () => {
  const original = process.env.LICENCE_EXPIRY_THRESHOLDS;
  process.env.LICENCE_EXPIRY_THRESHOLDS = 'banana, , -3';
  try {
    assert.deepEqual(getDefaultThresholdDays(), [30, 14, 7, 1, 0]);
  } finally {
    if (original === undefined) delete process.env.LICENCE_EXPIRY_THRESHOLDS;
    else process.env.LICENCE_EXPIRY_THRESHOLDS = original;
  }
});
