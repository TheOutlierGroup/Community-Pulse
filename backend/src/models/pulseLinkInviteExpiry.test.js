import test from 'node:test';
import assert from 'node:assert/strict';
import { pulseLinkTokenTtlDays } from './PulseLinkInvite.js';

/**
 * PT-02 cover for the TTL helper. The SQL-level behaviour (fail-closed
 * redemption, expiry stamped at issue, sweep revoking rather than
 * deleting) is asserted in routes/pulseLink.expiry.test.js and by reading
 * the statements themselves — this file pins the window calculation,
 * which is the part a stray env value can quietly break.
 */

function withEnv(value, fn) {
  const prior = process.env.PULSE_LINK_TOKEN_TTL_DAYS;
  if (value === undefined) delete process.env.PULSE_LINK_TOKEN_TTL_DAYS;
  else process.env.PULSE_LINK_TOKEN_TTL_DAYS = value;
  try {
    fn();
  } finally {
    if (prior === undefined) delete process.env.PULSE_LINK_TOKEN_TTL_DAYS;
    else process.env.PULSE_LINK_TOKEN_TTL_DAYS = prior;
  }
}

test('PT-02: defaults to 90 days when unset', () => {
  withEnv(undefined, () => assert.equal(pulseLinkTokenTtlDays(), 90));
});

test('PT-02: honours a configured window', () => {
  withEnv('30', () => assert.equal(pulseLinkTokenTtlDays(), 30));
});

test('PT-02: falls back to the default on unusable values', () => {
  for (const bad of ['', 'soon', '0', '-5']) {
    withEnv(bad, () => assert.equal(pulseLinkTokenTtlDays(), 90, `input ${JSON.stringify(bad)}`));
  }
});

test('PT-02: caps the window so a typo cannot restore a permanent link', () => {
  withEnv('99999', () => assert.equal(pulseLinkTokenTtlDays(), 365));
});
