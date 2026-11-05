import test from 'node:test';
import assert from 'node:assert/strict';
import { rebindPlatformNameToClientToken, UNASSIGNED_TEAM_LABEL } from './orgRoutes.js';

// RED-069: platform default invite templates were generated with the
// platform organisation's own name in the client's place, so every client
// inheriting them sent "Rhythm Engine questionnaire — Outlier".

test('a baked-in platform name in an inherited subject and body becomes {{clientName}}', () => {
  const out = rebindPlatformNameToClientToken(
    {
      subject: 'Rhythm Engine manager questionnaire — Outlier',
      bodyHtml: '<p>You have been invited to the questionnaire for <strong>Outlier</strong>.</p>',
    },
    'Outlier'
  );
  assert.equal(out.subject, 'Rhythm Engine manager questionnaire — {{clientName}}');
  assert.equal(out.bodyHtml, '<p>You have been invited to the questionnaire for <strong>{{clientName}}</strong>.</p>');
});

test('the platform name is only rebound where the generator placed it', () => {
  const template = {
    subject: 'Outlier invites you to Rhythm Engine',
    bodyHtml: '<p>Run by The Outlier Group.</p>',
  };
  assert.deepEqual(rebindPlatformNameToClientToken(template, 'Outlier'), template);
});

test('a template already using {{clientName}} is unchanged', () => {
  const template = {
    subject: 'Rhythm Engine questionnaire — {{clientName}}',
    bodyHtml: '<p>For <strong>{{clientName}}</strong>.</p>',
  };
  assert.deepEqual(rebindPlatformNameToClientToken(template, 'Outlier'), template);
});

test('RED-067: the neutral team label is a fixed word, never a person', () => {
  assert.equal(UNASSIGNED_TEAM_LABEL, 'Unassigned');
});
