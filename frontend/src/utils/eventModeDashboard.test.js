import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EVENT_QUADRANT_COPY,
  EVENT_CHAIN_COPY,
  EVENT_LOAD_COPY,
  rankChainRowsByRisk,
  limitGroupedRowsByRisk,
} from './eventModeDashboard.js';

test('every label has plain-English copy with no long dashes', () => {
  const all = [
    ...Object.values(EVENT_QUADRANT_COPY).flatMap((c) => [c.subtitle, c.action]),
    ...Object.values(EVENT_CHAIN_COPY),
    ...Object.values(EVENT_LOAD_COPY),
  ];
  assert.equal(Object.keys(EVENT_QUADRANT_COPY).length, 4);
  assert.equal(Object.keys(EVENT_CHAIN_COPY).length, 4);
  assert.equal(Object.keys(EVENT_LOAD_COPY).length, 4);
  for (const text of all) assert.doesNotMatch(text, /—/);
});

test('chain rows rank worst state, then heaviest load, then lowest capacity; withheld last', () => {
  const ranked = rankChainRowsByRisk([
    { managerId: 'ok', chainState: 'Chain Functioning', loadBand: 'Sustainable', capacityAvg: 18 },
    { managerId: 'hidden', chainState: null },
    { managerId: 'fail', chainState: 'Sponsorship Failed at Both Levels', loadBand: 'Stretched', capacityAvg: 9 },
    { managerId: 'break-light', chainState: 'Breaking at Manager Level', loadBand: 'Stretched', capacityAvg: 10 },
    { managerId: 'break-heavy', chainState: 'Breaking at Manager Level', loadBand: 'Overloaded', capacityAvg: 12 },
  ]);
  assert.deepEqual(ranked.map((r) => r.managerId), ['fail', 'break-heavy', 'break-light', 'ok', 'hidden']);
});

test('grouped rows keep the riskiest top-level groups and their expanded children', () => {
  const rows = [
    { key: 'a', parentKey: null, adoption: 30, sponsorship: 31 },
    { key: 'a1', parentKey: 'a', adoption: 20, sponsorship: 20 },
    { key: 'b', parentKey: null, adoption: 18, sponsorship: 25 },
    { key: 'c', parentKey: null, adoption: null, sponsorship: null },
    { key: 'd', parentKey: null, adoption: 26, sponsorship: 22 },
  ];
  const limited = limitGroupedRowsByRisk(rows, { limit: 2 });
  assert.equal(limited.totalGroups, 4);
  assert.deepEqual(limited.rows.map((r) => r.key), ['b', 'd']);

  const all = limitGroupedRowsByRisk(rows, { showAll: true });
  assert.deepEqual(all.rows.map((r) => r.key), ['b', 'd', 'a', 'a1', 'c']);
});

import { EVENT_QUADRANT_POST_ACTIONS } from './eventModeDashboard.js';

test('post-stage actions exist for every quadrant and avoid launch language', () => {
  for (const name of Object.keys(EVENT_QUADRANT_COPY)) {
    assert.ok(EVENT_QUADRANT_POST_ACTIONS[name], name);
    assert.doesNotMatch(EVENT_QUADRANT_POST_ACTIONS[name], /rollout|launch|Proceed/i);
  }
});
