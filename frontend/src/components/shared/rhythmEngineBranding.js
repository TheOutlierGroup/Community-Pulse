/**
 * BRAND-01: which default mark the chrome should carry for a given user.
 *
 * The build-time surface flag is passed in rather than imported, so this
 * stays a pure function testable under `node --test` — importing
 * config/appSurface.js here would pull in `import.meta.env`, which only
 * exists under Vite. (Adding `?.` to that lookup would make it testable
 * but risks breaking Vite's static replacement of the exact
 * `import.meta.env.VITE_APP_SURFACE` pattern at build time.)
 *
 * The surface flag alone is not enough to decide this. It is true only on
 * the standalone Rhythm Engine deployment, while a Practitioner
 * (licensee) admin and an Enterprise-tier client admin both work inside
 * the platform build at app.theoutliergroup.com.au — so both were shown
 * Outlier's internal branding despite Rhythm Engine being the only
 * product either of them uses.
 *
 * A licensee's own uploaded white-label logo still takes priority over
 * this; it only decides the fallback when no brand is configured.
 */
export function prefersRhythmEngineBrand(user, { isRhythmEngineSurface = false } = {}) {
  if (isRhythmEngineSurface) return true;
  if (!user) return false;
  // Practitioners resell Rhythm Engine and never see the wider CRM.
  if (user.organizationKind === 'licensee') return true;
  // Enterprise clients run Rhythm Engine on themselves through the
  // self-service portal; the standard tier has no portal access at all.
  if (user.organizationKind === 'client' && user.clientPortalTier === 'enterprise') return true;
  return false;
}
