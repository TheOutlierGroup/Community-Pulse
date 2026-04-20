import { getPostLoginPath } from '../../utils/postLogin.js';

export function sidebarBrandTargetForRoute({ user, pathname, orgId }) {
  const platformClientOrgId =
    user?.organizationKind === 'platform' && orgId ? orgId : null;
  const isPlatformRhythmEngineRoute =
    Boolean(platformClientOrgId) &&
    String(pathname || '').startsWith(`/platform/clients/${platformClientOrgId}/rhythm-engine`);

  if (isPlatformRhythmEngineRoute) return '/platform';
  return getPostLoginPath(user);
}
