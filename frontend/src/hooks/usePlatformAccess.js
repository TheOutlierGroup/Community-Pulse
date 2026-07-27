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

// Outlier platform staff only — narrower than isWorkspaceUser, which also
// includes licensee admins. Use this to gate actions that must never be
// available to a licensee (e.g. reverting a billing/contract field).
export function isPlatformStaffUser(user) {
  return Boolean(user && user.organizationKind === 'platform');
}

// Enterprise-tier client org users get self-service access to their own
// slice of the /platform/clients/:orgId workspace (Dashboard/Users/Tasks/
// Rhythm Engine) — see usePlatformClientAccess below. This is distinct
// from isWorkspaceUser: an Enterprise client is never a workspace user,
// and must never gain access to general /platform/* CRM-core surfaces
// (Clients list, Prospects, Campaigns, Contacts, staff Settings, other
// clients' data) — only usePlatformClientAccess, used solely by
// PlatformClientLayout.jsx, honors this flag.
export function isEnterpriseClientSelfUser(user) {
  return Boolean(user && user.organizationKind === 'client' && user.clientPortalTier === 'enterprise');
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

// Gate for PlatformClientLayout.jsx ONLY — the one place an Enterprise
// client's own users are allowed into the /platform/clients/:orgId/*
// workspace, and only for their own org. Every other /platform/* page
// must keep using usePlatformAccess/isWorkspaceUser unchanged.
export function usePlatformClientAccess(user, loading, navigate, orgId) {
  const location = useLocation();
  const allowed =
    isWorkspaceUser(user) || (isEnterpriseClientSelfUser(user) && String(user?.organizationId) === String(orgId));
  useEffect(() => {
    if (!loading && !user) {
      const intended = location.pathname + location.search;
      const dest = intended && intended !== '/' ? `/?returnTo=${encodeURIComponent(intended)}` : '/';
      navigate(dest);
    } else if (user && !allowed) {
      navigate(getPostLoginPath(user));
    }
  }, [user, loading, navigate, location, allowed]);
  return allowed;
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
