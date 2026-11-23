import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isEventModeAvailable,
  isEventModeActive,
  normalizeEventModeSettings,
  missingChangeContextFields,
  eventModeInviteBlock,
  validateEventModeInput,
  contrastRatio,
  readableTextColor,
  textSafeColor,
  brandTheme,
  respondentEventModePayload,
  WORDING_VERSION_EVENT,
} from './eventMode.js';
import { EVENT_STAFF_STATEMENTS, EVENT_MANAGER_STATEMENTS, eventSurveyCopy } from './eventModeWording.js';

const ON = { EVENT_MODE_AVAILABLE: 'true' };
const OFF = {};

const FULL_CONTEXT = {
  whatIsChanging: 'We are moving to a new rostering system.',
  whyAsking: 'To see how ready teams feel.',
  howUsed: 'The executive team will use it to set the rollout plan.',
  whenHearBack: 'By 15 December',
};

function client(eventMode, extra = {}) {
  return { id: 'org-1', kind: 'client', name: 'Acme', settings: { eventMode }, ...extra };
}

test('server switch is off unless explicitly "true"', () => {
  assert.equal(isEventModeAvailable(OFF), false);
  assert.equal(isEventModeAvailable({ EVENT_MODE_AVAILABLE: '1' }), false);
  assert.equal(isEventModeAvailable({ EVENT_MODE_AVAILABLE: 'TRUE' }), true);
});

test('Event mode needs both the server switch and the client toggle', () => {
  assert.equal(isEventModeActive(client({ enabled: true }), OFF), false);
  assert.equal(isEventModeActive(client({ enabled: false }), ON), false);
  assert.equal(isEventModeActive(client({ enabled: true }), ON), true);
  assert.equal(isEventModeActive({ kind: 'licensee', settings: { eventMode: { enabled: true } } }, ON), false);
  assert.equal(isEventModeActive(null, ON), false);
});

test('normalise tolerates junk and strips control characters', () => {
  const n = normalizeEventModeSettings({
    enabled: 'yes',
    changeName: '  New\u0007  roster  ',
    primaryColor: 'blue',
    changeContext: { pre: { whatIsChanging: 42 }, mid: 'nope' },
  });
  assert.equal(n.enabled, false);
  assert.equal(n.changeName, 'New roster');
  assert.equal(n.primaryColor, null);
  assert.equal(n.changeContext.pre.whatIsChanging, '42');
  assert.equal(n.changeContext.mid.howUsed, '');
});

test('missing change context lists the change name first, then empty fields', () => {
  assert.deepEqual(missingChangeContextFields({}, 'pre'), [
    'changeName',
    'whatIsChanging',
    'whyAsking',
    'howUsed',
    'whenHearBack',
  ]);
  assert.deepEqual(
    missingChangeContextFields({ changeName: 'Roster', changeContext: { pre: FULL_CONTEXT } }, 'pre'),
    []
  );
  // "during" and "completed" map onto mid and post.
  assert.deepEqual(
    missingChangeContextFields({ changeName: 'Roster', changeContext: { post: FULL_CONTEXT } }, 'completed'),
    []
  );
});

test('invites are blocked only while Event mode is on and context is incomplete', () => {
  const incomplete = client({ enabled: true, changeName: 'Roster', changeContext: { pre: { whatIsChanging: 'x' } } });
  const block = eventModeInviteBlock(incomplete, 'pre', ON);
  assert.ok(block);
  assert.match(block.error, /Why we're asking you/);
  assert.deepEqual(block.eventModeChangeContextMissing, ['whyAsking', 'howUsed', 'whenHearBack']);

  assert.equal(eventModeInviteBlock(incomplete, 'pre', OFF), null, 'no block when server switch off');
  assert.equal(eventModeInviteBlock(client({ enabled: false }), 'pre', ON), null, 'no block when toggle off');
  const complete = client({ enabled: true, changeName: 'Roster', changeContext: { pre: FULL_CONTEXT } });
  assert.equal(eventModeInviteBlock(complete, 'pre', ON), null);
  assert.ok(eventModeInviteBlock(complete, 'mid', ON), 'mid stage still incomplete');
});

test('validate merges partial updates and keeps existing values', () => {
  const existing = { enabled: true, changeName: 'Roster', primaryColor: '#123456', changeContext: { pre: FULL_CONTEXT } };
  const result = validateEventModeInput({ changeContext: { pre: { whenHearBack: 'By Friday' } } }, existing);
  assert.ok(result.value);
  assert.equal(result.value.enabled, true);
  assert.equal(result.value.primaryColor, '#123456');
  assert.equal(result.value.changeContext.pre.whenHearBack, 'By Friday');
  assert.equal(result.value.changeContext.pre.howUsed, FULL_CONTEXT.howUsed);
});

test('validate rejects bad colours and over-long text, and clears empty colours', () => {
  const bad = validateEventModeInput({ primaryColor: 'red', changeName: 'x'.repeat(81) }, {});
  assert.ok(bad.errors);
  assert.equal(bad.errors.length, 2);
  const cleared = validateEventModeInput({ primaryColor: '' }, { primaryColor: '#123456' });
  assert.equal(cleared.value.primaryColor, null);
  const ok = validateEventModeInput({ primaryColor: '#1A73E8', enabled: true }, {});
  assert.equal(ok.value.primaryColor, '#1a73e8');
  assert.equal(ok.value.enabled, true);
});

test('colour helpers: contrast, readable text and text-safe darkening', () => {
  assert.equal(Math.round(contrastRatio('#000000', '#ffffff')), 21);
  assert.equal(readableTextColor('#ffeb3b'), '#1c1917', 'dark text on yellow');
  assert.equal(readableTextColor('#0b3d91'), '#ffffff', 'white text on navy');
  const safe = textSafeColor('#ffeb3b');
  assert.ok(contrastRatio(safe, '#ffffff') >= 4.5, 'pale yellow darkened enough to read on white');
  assert.equal(textSafeColor('#0b3d91'), '#0b3d91', 'already-dark colour unchanged');
});

test('brand theme is null without a primary colour', () => {
  assert.equal(brandTheme({}), null);
  const theme = brandTheme({ primaryColor: '#0b3d91' });
  assert.equal(theme.primaryRgb, '11, 61, 145');
  assert.equal(theme.onPrimary, '#ffffff');
});

test('respondent payload exposes only presentation fields for the invite stage', () => {
  const org = client(
    { enabled: true, changeName: 'Roster', primaryColor: '#0b3d91', changeContext: { mid: FULL_CONTEXT } },
    { settings: { eventMode: { enabled: true, changeName: 'Roster', primaryColor: '#0b3d91', changeContext: { mid: FULL_CONTEXT } }, pulseInviteDueDates: { pre: '2026-01-01' } } }
  );
  const payload = respondentEventModePayload(org, 'during', { env: ON });
  assert.equal(payload.wordingVersion, WORDING_VERSION_EVENT);
  assert.equal(payload.changeName, 'Roster');
  assert.deepEqual(payload.changeContext, FULL_CONTEXT);
  assert.equal(payload.minGroupSize, 5);
  assert.equal(payload.pulseInviteDueDates, undefined);
  assert.equal(respondentEventModePayload(org, 'mid', { env: OFF }), null);
});

test('event wording covers all 16 statements for every stage and audience', () => {
  for (const stage of ['pre', 'mid', 'post']) {
    const staff = Object.keys(EVENT_STAFF_STATEMENTS[stage]);
    const manager = Object.keys(EVENT_MANAGER_STATEMENTS[stage]);
    assert.deepEqual(staff, Array.from({ length: 16 }, (_, i) => `Q${i + 1}`));
    assert.deepEqual(manager, Array.from({ length: 16 }, (_, i) => `MQ${i + 1}`));
    for (const text of [...Object.values(EVENT_STAFF_STATEMENTS[stage]), ...Object.values(EVENT_MANAGER_STATEMENTS[stage])]) {
      const bold = text.match(/\*\*(.+?)\*\*/g) || [];
      assert.equal(bold.length, 1, `exactly one bold phrase: ${text}`);
      assert.doesNotMatch(text, /—/, 'no long dashes');
      assert.doesNotMatch(text, /anonymous/i);
    }
  }
});

test('event survey copy has stage-specific intros and the halfway note', () => {
  const copy = eventSurveyCopy('manager', 'post');
  assert.match(copy.intro, /as a manager/);
  assert.match(copy.transition, /^Answer as a manager\./);
  assert.match(copy.halfwayNote, /halfway/);
});
