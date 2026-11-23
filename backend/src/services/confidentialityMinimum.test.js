import test from 'node:test';
import assert from 'node:assert/strict';
import {
  minimumForStageRows,
  minimumToPromise,
  normalizeSmallOrgSetting,
  STANDARD_MINIMUM,
  SMALL_ORG_MINIMUM,
} from './confidentialityMinimum.js';

const ON = { smallOrgMinimum: { enabled: true, enabledAt: '2026-11-24T00:00:00.000Z' } };

test('standard minimum is 5 and the small-organisation minimum is 3', () => {
  assert.equal(STANDARD_MINIMUM, 5);
  assert.equal(SMALL_ORG_MINIMUM, 3);
});

test('setting off: always 5, whatever was promised', () => {
  assert.equal(minimumForStageRows({}, []), 5);
  assert.equal(minimumForStageRows({}, [{ promised_min_group_size: 3 }]), 5);
  assert.equal(minimumToPromise({}, []), 5);
});

test('setting on: a group where everyone was told 3 reports at 3', () => {
  assert.equal(minimumForStageRows(ON, []), 3);
  assert.equal(minimumForStageRows(ON, [{ promised_min_group_size: 3 }, { promised_min_group_size: 3 }]), 3);
});

test('one person told 5 (or before promises were recorded) keeps the group at 5', () => {
  assert.equal(minimumForStageRows(ON, [{ promised_min_group_size: 3 }, { promised_min_group_size: 5 }]), 5);
  assert.equal(minimumForStageRows(ON, [{ promised_min_group_size: 3 }, { promised_min_group_size: null }]), 5);
  assert.equal(minimumForStageRows(ON, [{ promised_min_group_size: 3 }, { source_type: 'employee' }]), 5);
});

test('new respondents are told 3 only when nobody else in the session was told 5', () => {
  assert.equal(minimumToPromise(ON, []), 3);
  assert.equal(minimumToPromise(ON, [{ promised_min_group_size: 3 }]), 3);
  assert.equal(minimumToPromise(ON, [{ promised_min_group_size: null }]), 5);
});

test('normalise rejects malformed settings', () => {
  assert.deepEqual(normalizeSmallOrgSetting('yes'), { enabled: false, enabledAt: null });
  assert.equal(normalizeSmallOrgSetting({ enabled: true }).enabled, true);
});
