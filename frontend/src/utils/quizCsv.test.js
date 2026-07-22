import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv } from './contactImportCsv.js';
import { mapQuizRows, looksLikeQuiz, personaLabel, changeStateLabel } from './quizCsv.js';

// Header mirrors the real Formidable export: blank Name/Email headers, the
// free-text Q9, and ID/Timestamp at the end.
const HEADER = 'utm_source,utm_campaign,utm_medium,utm_content,persona,"9. In one sentence: what\'s the single biggest thing that could derail this program?",score_adoption,change_state,,,Timestamp,ID';

test('maps blank-header Name/Email by email pattern, not position', () => {
  const csv = [HEADER, ',,,,persona-pop,LIFE,12,state-optimal,Ananda Ramiah,connect@rhythmengine.io,17/07/2026 5:33,106'].join('\n');
  const parsed = parseCsv(csv);
  const [e] = mapQuizRows(parsed);
  assert.equal(e.external_id, '106');
  assert.equal(e.name, 'Ananda Ramiah');
  assert.equal(e.email, 'connect@rhythmengine.io');
  assert.equal(e.persona, 'persona-pop');
  assert.equal(e.change_state, 'state-optimal');
  assert.equal(e.change_risk, 'LIFE'); // matched Q9 by wording
  assert.equal(e.submitted_at, '17/07/2026 5:33');
  assert.equal(e.raw.score_adoption, '12'); // noise preserved in raw
});

test('raw blob keeps every column, disambiguating blanks as name/email', () => {
  const csv = [HEADER, ',,,,persona-pap,Risk text,9,state-high-risk,Bob Tester,bob@email.com,2026-07-20 21:12:24,108'].join('\n');
  const [e] = mapQuizRows(parseCsv(csv));
  assert.equal(e.raw.name, 'Bob Tester');
  assert.equal(e.raw.email, 'bob@email.com');
  assert.equal(e.raw.ID, '108');
});

test('change_risk falls back to the column before score_adoption when wording differs', () => {
  const header = 'persona,Some Other Q9 wording,score_adoption,change_state,,,Timestamp,ID';
  const csv = [header, 'persona-pop,the derailer,10,state-optimal,Jo,jo@x.com,17/07/2026 5:33,200'].join('\n');
  const [e] = mapQuizRows(parseCsv(csv));
  assert.equal(e.change_risk, 'the derailer');
});

test('looksLikeQuiz detects a Formidable export', () => {
  assert.equal(looksLikeQuiz(parseCsv(HEADER + '\n,,,,persona-pop,x,1,state-optimal,A,a@x.com,17/07/2026 5:33,1')), true);
  assert.equal(looksLikeQuiz(parseCsv('First name,Email\nKay,kay@x.com')), false);
});

test('display labels map persona and change_state', () => {
  assert.equal(personaLabel('persona-pop'), 'People (POP)');
  assert.equal(personaLabel('persona-pap'), 'Operations (PAP)');
  assert.equal(changeStateLabel('state-capable-wary'), 'Capable but wary');
});
