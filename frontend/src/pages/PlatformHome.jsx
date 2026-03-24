import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../services/api.js';
import { useAuth } from '../components/shared/Auth.jsx';
import Layout from '../components/shared/Layout.jsx';
import { usePlatformAccess } from '../hooks/usePlatformAccess.js';
import { Building2, LayoutDashboard, Users } from 'lucide-react';

export default function PlatformHome() {
  const { user, logout, loading } = useAuth();
  const navigate = useNavigate();
  const ok = usePlatformAccess(user, loading, navigate);
  const [orgCount, setOrgCount] = useState(null);
  const [staffCount, setStaffCount] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const [o, s] = await Promise.all([
        api.get('/api/platform/organizations'),
        api.get('/api/platform/staff'),
      ]);
      setOrgCount((o.data.organizations || []).length);
      setStaffCount((s.data.users || []).length);
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to load summary.');
    }
  }, []);

  useEffect(() => {
    if (ok) load();
  }, [ok, load]);

  if (loading || !ok) return null;

  return (
    <Layout user={user} onLogout={logout}>
      <h1 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <LayoutDashboard size={28} strokeWidth={1.75} aria-hidden />
        Dashboard
      </h1>
      <p className="muted" style={{ marginBottom: '1.5rem' }}>
        Platform overview — manage client companies and Outlier team access.
      </p>
      {error && <p className="error">{error}</p>}
      <div className="grid-2" style={{ alignItems: 'stretch' }}>
        <Link to="/platform/clients" className="card platform-dash-card">
          <Building2 size={24} strokeWidth={1.75} aria-hidden />
          <h2 style={{ marginTop: '0.75rem' }}>Clients</h2>
          <p className="muted" style={{ marginBottom: 0 }}>
            {orgCount != null ? `${orgCount} compan${orgCount === 1 ? 'y' : 'ies'}` : '…'}
          </p>
          <span className="platform-dash-card__cta">Open list</span>
        </Link>
        <Link to="/platform/users" className="card platform-dash-card">
          <Users size={24} strokeWidth={1.75} aria-hidden />
          <h2 style={{ marginTop: '0.75rem' }}>Users</h2>
          <p className="muted" style={{ marginBottom: 0 }}>
            {staffCount != null
              ? `${staffCount} team member${staffCount === 1 ? '' : 's'}`
              : '…'}
          </p>
          <span className="platform-dash-card__cta">Manage users</span>
        </Link>
      </div>
    </Layout>
  );
}
