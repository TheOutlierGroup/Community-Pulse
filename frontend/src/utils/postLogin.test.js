import test from 'node:test';
import assert from 'node:assert/strict';
import { getPostLoginPath, isPostLoginPathServedByRhythmEngineSurface } from './postLogin.js';

test('getPostLoginPath sends an Enterprise-tier client admin to their platform client workspace', () => {
  const path = getPostLoginPath({
    organizationKind: 'client',
    clientPortalTier: 'enterprise',
    organizationId: 'org-1',
    role: 'admin',
  });
  assert.equal(path, '/platform/clients/org-1');
});

// BUG: that bare path has no matching route in the standalone Rhythm
// Engine build's route tree (AppRhythmEngine.jsx) — only its
// /rhythm-engine child does. Anything consuming getPostLoginPath while
// running on that build must check this before doing an in-app
// navigation, or Enterprise admins land on a blank page stuck on the
// Rhythm Engine origin.
test('the bare platform client path is not servable by the rhythm engine surface', () => {
  assert.equal(isPostLoginPathServedByRhythmEngineSurface('/platform/clients/org-1'), false);
});

test('the /platform staff landing is not servable by the rhythm engine surface', () => {
  assert.equal(isPostLoginPathServedByRhythmEngineSurface('/platform'), false);
});

test('the rhythm engine surface serves /client, /admin, /account and /rhythm-engine directly', () => {
  assert.equal(isPostLoginPathServedByRhythmEngineSurface('/client'), true);
  assert.equal(isPostLoginPathServedByRhythmEngineSurface('/admin'), true);
  assert.equal(isPostLoginPathServedByRhythmEngineSurface('/account'), true);
  assert.equal(isPostLoginPathServedByRhythmEngineSurface('/rhythm-engine'), true);
});
