import { getPostLoginPath } from '../../utils/postLogin.js';

const WORKSPACE_KINDS = new Set(['platform', 'licensee']);

export function sidebarBrandTargetForRoute({ user, pathname, orgId }) {
  const isWorkspace = user && WORKSPACE_KINDS.has(user.organizationKind);
  const platformClientOrgId = isWorkspace && orgId ? orgId : null;
  const isPlatformRhythmEngineRoute =
    Boolean(platformClientOrgId) &&
    String(pathname || '').startsWith(`/platform/clients/${platformClientOrgId}/rhythm-engine`);

  if (isPlatformRhythmEngineRoute) return '/platform';
  return getPostLoginPath(user);
}
