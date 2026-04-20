import { getPostLoginPath } from '../../utils/postLogin.js';

export function sidebarBrandTargetForRoute({ user, pathname, orgId }) {
  const platformClientOrgId =
    user?.organizationKind === 'platform' && orgId ? orgId : null;
  const isPlatformPulseRoute =
    Boolean(platformClientOrgId) &&
    String(pathname || '').startsWith(`/platform/clients/${platformClientOrgId}/pulse`);

  if (isPlatformPulseRoute) return '/platform';
  return getPostLoginPath(user);
}
