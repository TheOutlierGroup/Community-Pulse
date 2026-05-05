import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import api, { loadStoredToken, setAuthToken } from '../../services/api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [brand, setBrand] = useState(null);

  async function fetchBrandSafely() {
    try {
      const { data } = await api.get('/api/auth/me/brand');
      setBrand(data?.brand || null);
    } catch {
      // INF-06: brand is optional chrome — never block auth on it.
      setBrand(null);
    }
  }

  useEffect(() => {
    const token = loadStoredToken();
    if (!token) {
      setLoading(false);
      return;
    }
    api
      .get('/api/auth/me')
      .then((res) => {
        setUser(res.data);
        return fetchBrandSafely();
      })
      .catch(() => {
        setAuthToken(null);
        setUser(null);
        setBrand(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const value = useMemo(
    () => ({
      user,
      loading,
      brand,
      setUserFromLogin(data) {
        setAuthToken(data.token);
        setUser(data.user);
        fetchBrandSafely();
      },
      async refreshUser() {
        const { data } = await api.get('/api/auth/me');
        setUser(data);
        await fetchBrandSafely();
      },
      async refreshBrand() {
        await fetchBrandSafely();
      },
      setCurrentUser(nextUser) {
        setUser(nextUser);
      },
      logout() {
        setAuthToken(null);
        setUser(null);
        setBrand(null);
      },
    }),
    [user, loading, brand]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
