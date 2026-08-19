import { getPostLoginPath, isPostLoginPathServedByRhythmEngineSurface } from '../../utils/postLogin.js';

const WORKSPACE_KINDS = new Set(['platform', 'licensee']);

// isRhythmEngineSurface/crmBaseUrl are passed in rather than imported from
// config/appSurface.js, same reasoning as rhythmEngineBranding.js: that
// module reads import.meta.env, which only exists under Vite, and this
// function stays testable under `node --test` without it.
export function sidebarBrandTargetForRoute({ user, pathname, orgId, isRhythmEngineSurface = false, crmBaseUrl = '' }) {
  const isWorkspace = user && WORKSPACE_KINDS.has(user.organizationKind);
  const platformClientOrgId = isWorkspace && orgId ? orgId : null;
  const isPlatformRhythmEngineRoute =
    Boolean(platformClientOrgId) &&
    String(pathname || '').startsWith(`/platform/clients/${platformClientOrgId}/rhythm-engine`);

  const path = isPlatformRhythmEngineRoute ? '/platform' : getPostLoginPath(user);

  // On the standalone Rhythm Engine build, a workspace user (viewing a
  // client's Rhythm Engine tab) or an Enterprise-tier client's own admin
  // resolves to a path ('/platform' or the bare '/platform/clients/:orgId')
  // that build never routes — clicking the brand logo would otherwise
  // leave them on a blank page, stuck on the Rhythm Engine origin. Cross
  // back to the CRM origin instead.
  if (isRhythmEngineSurface && crmBaseUrl && !isPostLoginPathServedByRhythmEngineSurface(path)) {
    return `${crmBaseUrl}${path}`;
  }
  return path;
}
