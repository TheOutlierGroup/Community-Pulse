import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { getPostLoginPath } from '../utils/postLogin.js';

const WORKSPACE_ORGANIZATION_KINDS = new Set(['platform', 'licensee']);

export function isWorkspaceUser(user) {
  return Boolean(user && WORKSPACE_ORGANIZATION_KINDS.has(user.organizationKind));
}

export function isLicenseeUser(user) {
  return Boolean(user && user.organizationKind === 'licensee');
}

export function usePlatformAccess(user, loading, navigate) {
  const location = useLocation();
  useEffect(() => {
    if (!loading && !user) {
      const intended = location.pathname + location.search;
      const dest = intended && intended !== '/' ? `/?returnTo=${encodeURIComponent(intended)}` : '/';
      navigate(dest);
    } else if (user && !isWorkspaceUser(user)) {
      navigate(getPostLoginPath(user));
    }
  }, [user, loading, navigate, location]);
  return isWorkspaceUser(user);
}

// Same as usePlatformAccess but rejects licensee users — for surfaces like
// Tasks and the platform service catalog that licensees never see.
export function usePlatformOnlyAccess(user, loading, navigate) {
  const location = useLocation();
  useEffect(() => {
    if (!loading && !user) {
      const intended = location.pathname + location.search;
      const dest = intended && intended !== '/' ? `/?returnTo=${encodeURIComponent(intended)}` : '/';
      navigate(dest);
    } else if (user && user.organizationKind !== 'platform') {
      navigate(isWorkspaceUser(user) ? '/platform' : getPostLoginPath(user));
    }
  }, [user, loading, navigate, location]);
  return Boolean(user && user.organizationKind === 'platform');
}
