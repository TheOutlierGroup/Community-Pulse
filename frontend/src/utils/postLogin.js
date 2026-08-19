import { CLIENT_SERVICE_PULSE, userHasService } from './clientServices.js';

export { CLIENT_SERVICE_PULSE, userHasService };

export function getPostLoginPath(user) {
  if (!user) return '/';
  if (user.organizationKind === 'platform') return '/platform';
  if (user.organizationKind === 'licensee') return '/platform';
  if (user.organizationKind === 'client') {
    if (user.clientPortalTier === 'enterprise') return `/platform/clients/${user.organizationId}`;
    if (user.role === 'admin') return '/client';
    return userHasService(user, CLIENT_SERVICE_PULSE) ? '/rhythm-engine' : '/account';
  }
  if (user.role === 'admin') return '/client';
  return '/rhythm-engine';
}

// Home paths the standalone Rhythm Engine build (AppRhythmEngine.jsx) can
// actually serve — that build's route tree is deliberately narrower than
// the CRM's (see its file-level comment). getPostLoginPath was written
// against the full CRM tree, so a path outside this set (e.g. '/platform'
// or the bare '/platform/clients/:orgId') has no matching route there: an
// empty Outlet renders under Layout's chrome, and since these paths are
// reached via the SPA's own client-side navigation, the browser is stuck
// on the Rhythm Engine origin with a blank content area rather than
// crossing back to the CRM origin that actually serves them.
const RHYTHM_ENGINE_SURFACE_HOME_PATHS = new Set(['/client', '/admin', '/account', '/rhythm-engine']);

export function isPostLoginPathServedByRhythmEngineSurface(path) {
  return RHYTHM_ENGINE_SURFACE_HOME_PATHS.has(path);
}
