import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { SlidersHorizontal } from 'lucide-react';
import { useAuth } from '../components/shared/Auth.jsx';
import Layout from '../components/shared/Layout.jsx';
import { usePlatformAccess } from '../hooks/usePlatformAccess.js';
import { useDocumentTitle, DEFAULT_TAB } from '../hooks/useDocumentTitle.js';
import api from '../services/api.js';
import { CLIENT_SERVICE_OPTIONS, normalizeServices } from '../utils/clientServices.js';

export default function PlatformSettings() {
  const { user, logout, loading, setCurrentUser } = useAuth();
  const navigate = useNavigate();
  const ok = usePlatformAccess(user, loading, navigate);
  const isPlatformAdmin = ok && user?.role === 'admin';
  const [orgServices, setOrgServices] = useState([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    setOrgServices(normalizeServices({ services: user?.enabledServices }));
  }, [user?.enabledServices]);

  useEffect(() => {
    if (!loading && ok && user?.role !== 'admin') {
      navigate('/platform', { replace: true });
    }
  }, [loading, ok, user, navigate]);

  function onToggleService(serviceId, checked) {
    setOrgServices((current) =>
      checked
        ? Array.from(new Set([...current, serviceId]))
        : current.filter((id) => id !== serviceId)
    );
  }

  async function saveOrganizationServices(e) {
    e.preventDefault();
    setBusy(true);
    setMessage('');
    setError('');
    try {
      const { data } = await api.patch('/api/auth/me/organization-services', {
        services: orgServices,
      });
      setCurrentUser(data.user);
      setMessage('Organization services saved.');
    } catch (err) {
      setError(err.response?.data?.error || 'Could not save organization services.');
    } finally {
      setBusy(false);
    }
  }

  useDocumentTitle(!loading && isPlatformAdmin ? `Settings | ${DEFAULT_TAB}` : null);

  if (loading || !isPlatformAdmin) return null;

  return (
    <Layout user={user} onLogout={logout}>
      <div className="page-header-row">
        <div>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0 }}>
            <SlidersHorizontal size={28} strokeWidth={1.75} aria-hidden />
            Settings
          </h1>
        </div>
      </div>
      <div className="card" style={{ marginTop: '1rem' }}>
        <h2 className="settings-section-title">Organization services</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Tick the services your organization is paying for. Only Pulse changes app behavior.
        </p>
        {error ? (
          <p className="error" style={{ marginTop: '0.75rem', marginBottom: '0.5rem' }}>
            {error}
          </p>
        ) : null}
        {message ? (
          <p className="muted" style={{ marginTop: '0.75rem', marginBottom: '0.5rem' }}>
            {message}
          </p>
        ) : null}
        <form onSubmit={saveOrganizationServices}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.45rem 1rem' }}>
            {CLIENT_SERVICE_OPTIONS.map((service) => (
              <label key={service.id} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <input
                  type="checkbox"
                  checked={orgServices.includes(service.id)}
                  disabled={busy}
                  onChange={(e) => onToggleService(service.id, e.target.checked)}
                />
                <span>{service.label}</span>
              </label>
            ))}
          </div>
          <button type="submit" className="btn btn-ghost" disabled={busy} style={{ marginTop: '0.9rem' }}>
            Save services
          </button>
        </form>
      </div>
    </Layout>
  );
}
