import { useEffect } from 'react';
import { getPostLoginPath } from '../utils/postLogin.js';

export function usePlatformAccess(user, loading, navigate) {
  useEffect(() => {
    if (!loading && !user) navigate('/');
    else if (user && user.organizationKind !== 'platform') navigate(getPostLoginPath(user));
  }, [user, loading, navigate]);
  return Boolean(user && user.organizationKind === 'platform');
}
