import test from 'node:test';
import assert from 'node:assert/strict';
import { prefersRhythmEngineBrand } from './rhythmEngineBranding.js';

/**
 * BRAND-01: which users see the Rhythm Engine mark rather than Outlier's.
 *
 * The build-time surface flag was not enough on its own. Practitioners
 * (licensees) and Enterprise-tier client admins both work inside the
 * platform build at app.theoutliergroup.com.au, so both were shown
 * Outlier's internal branding despite Rhythm Engine being the only
 * product either of them uses.
 *
 * These tests run against the default (CRM) build, where
 * IS_RHYTHM_ENGINE_SURFACE is false — which is exactly the case that was
 * wrong.
 */

test('BRAND-01: the standalone Rhythm Engine surface always uses its own brand', () => {
  assert.equal(prefersRhythmEngineBrand(null, { isRhythmEngineSurface: true }), true);
  assert.equal(
    prefersRhythmEngineBrand({ organizationKind: 'platform' }, { isRhythmEngineSurface: true }),
    true
  );
});

test('BRAND-01: a Practitioner (licensee) admin gets the Rhythm Engine brand', () => {
  assert.equal(
    prefersRhythmEngineBrand({ organizationKind: 'licensee', role: 'admin' }),
    true
  );
});

test('BRAND-01: a Practitioner employee gets it too — it is org-level, not role-level', () => {
  assert.equal(
    prefersRhythmEngineBrand({ organizationKind: 'licensee', role: 'employee' }),
    true
  );
});

test('BRAND-01: an Enterprise-tier client gets the Rhythm Engine brand', () => {
  assert.equal(
    prefersRhythmEngineBrand({ organizationKind: 'client', clientPortalTier: 'enterprise' }),
    true
  );
});

test('BRAND-01: a standard-tier client does not', () => {
  // Standard-tier clients have no self-service portal at all, so they
  // never reach this chrome — but pin the boundary so a future change to
  // portal tiers has to be deliberate.
  assert.equal(
    prefersRhythmEngineBrand({ organizationKind: 'client', clientPortalTier: 'standard' }),
    false
  );
});

test('BRAND-01: Outlier platform staff keep the Outlier brand', () => {
  assert.equal(
    prefersRhythmEngineBrand({ organizationKind: 'platform', role: 'admin' }),
    false
  );
  assert.equal(
    prefersRhythmEngineBrand({ organizationKind: 'platform', role: 'basic' }),
    false
  );
});

test('BRAND-01: a missing or partial user does not crash and defaults to Outlier', () => {
  // Layout renders with user={null} on the SSO exchange screen.
  assert.equal(prefersRhythmEngineBrand(null), false);
  assert.equal(prefersRhythmEngineBrand(undefined), false);
  assert.equal(prefersRhythmEngineBrand({}), false);
  assert.equal(prefersRhythmEngineBrand({ organizationKind: 'client' }), false);
});
