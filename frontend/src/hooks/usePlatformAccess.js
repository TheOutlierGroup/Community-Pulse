import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { getPostLoginPath } from '../utils/postLogin.js';

export function usePlatformAccess(user, loading, navigate) {
  const location = useLocation();
  useEffect(() => {
    if (!loading && !user) {
      const intended = location.pathname + location.search;
      const dest = intended && intended !== '/' ? `/?returnTo=${encodeURIComponent(intended)}` : '/';
      navigate(dest);
    } else if (user && user.organizationKind !== 'platform') {
      navigate(getPostLoginPath(user));
    }
  }, [user, loading, navigate, location]);
  return Boolean(user && user.organizationKind === 'platform');
}
