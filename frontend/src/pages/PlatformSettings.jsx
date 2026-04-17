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
  const [serviceToAdd, setServiceToAdd] = useState('');

  useEffect(() => {
    setOrgServices(normalizeServices({ services: user?.enabledServices }));
  }, [user?.enabledServices]);

  useEffect(() => {
    if (!loading && ok && user?.role !== 'admin') {
      navigate('/platform', { replace: true });
    }
  }, [loading, ok, user, navigate]);

  function addService(serviceId) {
    const id = String(serviceId || '').trim().toLowerCase();
    if (!id) return;
    setOrgServices((current) => (current.includes(id) ? current : [...current, id]));
    setServiceToAdd('');
  }

  function removeService(serviceId) {
    setOrgServices((current) => current.filter((id) => id !== serviceId));
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

  const selectedServices = CLIENT_SERVICE_OPTIONS.filter((service) => orgServices.includes(service.id));
  const addableServices = CLIENT_SERVICE_OPTIONS.filter((service) => !orgServices.includes(service.id));

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
          Manage the services your organization is paying for. Only Pulse changes app behavior.
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
          <div style={{ display: 'grid', gap: '0.65rem' }}>
            {selectedServices.length ? (
              selectedServices.map((service) => (
                <div
                  key={service.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '0.75rem',
                    padding: '0.45rem 0.6rem',
                    border: '1px solid var(--line)',
                    borderRadius: '0.5rem',
                  }}
                >
                  <span>{service.label}</span>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={busy}
                    onClick={() => removeService(service.id)}
                  >
                    Remove
                  </button>
                </div>
              ))
            ) : (
              <p className="muted" style={{ margin: 0 }}>
                No services added yet.
              </p>
            )}
          </div>
          <div style={{ display: 'flex', gap: '0.6rem', marginTop: '0.9rem', flexWrap: 'wrap' }}>
            <select
              value={serviceToAdd}
              disabled={busy || addableServices.length === 0}
              onChange={(e) => setServiceToAdd(e.target.value)}
              style={{ minWidth: '240px' }}
            >
              <option value="">{addableServices.length ? 'Select a service to add' : 'All services are added'}</option>
              {addableServices.map((service) => (
                <option key={service.id} value={service.id}>
                  {service.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={busy || !serviceToAdd}
              onClick={() => addService(serviceToAdd)}
            >
              Add service
            </button>
          </div>
          <button type="submit" className="btn btn-ghost" disabled={busy} style={{ marginTop: '0.9rem' }}>
            Save services
          </button>
        </form>
      </div>
    </Layout>
  );
}
