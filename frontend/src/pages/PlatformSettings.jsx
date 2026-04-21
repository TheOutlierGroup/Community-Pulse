import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { SlidersHorizontal } from 'lucide-react';
import { useAuth } from '../components/shared/Auth.jsx';
import Layout from '../components/shared/Layout.jsx';
import { usePlatformAccess } from '../hooks/usePlatformAccess.js';
import { useDocumentTitle, DEFAULT_TAB } from '../hooks/useDocumentTitle.js';
import api from '../services/api.js';
import {
  CLIENT_SERVICE_OTHER,
  CLIENT_SERVICE_PULSE,
  normalizeServiceCatalog,
} from '../utils/clientServices.js';

const LOCKED_SERVICE_IDS = new Set([CLIENT_SERVICE_PULSE, CLIENT_SERVICE_OTHER]);

export default function PlatformSettings() {
  const { user, logout, loading } = useAuth();
  const navigate = useNavigate();
  const ok = usePlatformAccess(user, loading, navigate);
  const isPlatformAdmin = ok && user?.role === 'admin';
  const [serviceCatalog, setServiceCatalog] = useState([]);
  const [newServiceName, setNewServiceName] = useState('');
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isPlatformAdmin) return;
    (async () => {
      setLoadingCatalog(true);
      setError('');
      try {
        const { data } = await api.get('/api/platform/service-catalog');
        const normalized = normalizeServiceCatalog(data.services, { fallbackToDefaults: false }).map((service) => ({
          key: service.id,
          id: service.id,
          name: service.name,
        }));
        setServiceCatalog(normalized);
      } catch (err) {
        setError(err.response?.data?.error || 'Could not load service catalog.');
      } finally {
        setLoadingCatalog(false);
      }
    })();
  }, [isPlatformAdmin]);

  useEffect(() => {
    if (!loading && ok && user?.role !== 'admin') {
      navigate('/platform', { replace: true });
    }
  }, [loading, ok, user, navigate]);

  function updateServiceName(key, name) {
    setServiceCatalog((current) =>
      current.map((service) =>
        service.key === key
          ? {
              ...service,
              name:
                service.id === CLIENT_SERVICE_PULSE
                  ? 'Rhythm Engine'
                  : service.id === CLIENT_SERVICE_OTHER
                    ? 'Other'
                    : name,
            }
          : service
      )
    );
  }

  function addServiceRow() {
    const trimmed = newServiceName.trim();
    if (!trimmed) return;
    setServiceCatalog((current) => [
      ...current,
      {
        key: `new-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        id: '',
        name: trimmed,
      },
    ]);
    setNewServiceName('');
  }

  function removeServiceRow(key, name) {
    const label = String(name || '').trim() || 'this service';
    if (!window.confirm(`Delete "${label}" from the service catalog?`)) return;
    setServiceCatalog((current) => current.filter((service) => service.key !== key));
  }

  async function saveServiceCatalog(e) {
    e.preventDefault();
    const nextServices = serviceCatalog
      .map((service) => ({
        id: String(service.id || '').trim(),
        name:
          service.id === CLIENT_SERVICE_PULSE
            ? 'Rhythm Engine'
            : service.id === CLIENT_SERVICE_OTHER
              ? 'Other'
              : String(service.name || '').trim(),
      }))
      .filter((service) => service.name);
    if (nextServices.length !== serviceCatalog.length) {
      setError('Each service needs a name before saving.');
      setMessage('');
      return;
    }
    setBusy(true);
    setMessage('');
    setError('');
    try {
      const { data } = await api.patch('/api/platform/service-catalog', {
        services: nextServices,
      });
      const normalized = normalizeServiceCatalog(data.services, { fallbackToDefaults: false }).map((service) => ({
        key: service.id,
        id: service.id,
        name: service.name,
      }));
      setServiceCatalog(normalized);
      setMessage('Service catalog saved.');
    } catch (err) {
      setError(err.response?.data?.error || 'Could not save service catalog.');
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
        <h2 className="settings-section-title">Service catalog</h2>
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
        <form onSubmit={saveServiceCatalog}>
          <div className="table-wrap service-catalog-table-wrap">
            <table className="admin-table service-catalog-table">
              <thead>
                <tr>
                  <th scope="col">Service name</th>
                  <th scope="col" style={{ width: '1%' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {loadingCatalog ? (
                  <tr>
                    <td colSpan={2} className="muted" style={{ padding: '1rem' }}>
                      Loading services...
                    </td>
                  </tr>
                ) : serviceCatalog.length === 0 ? (
                  <tr>
                    <td colSpan={2} className="muted" style={{ padding: '1rem' }}>
                      No services yet. Add your first service below.
                    </td>
                  </tr>
                ) : (
                  serviceCatalog.map((service) => (
                    <tr key={service.key}>
                      <td>
                        <div className="service-catalog-name-cell">
                        <input
                          className="service-catalog-input"
                          value={service.name}
                          onChange={(e) => updateServiceName(service.key, e.target.value)}
                          disabled={busy || LOCKED_SERVICE_IDS.has(service.id)}
                          aria-label="Service name"
                        />
                          {service.id === CLIENT_SERVICE_PULSE ? (
                            <span className="badge badge-active">Required</span>
                          ) : service.id === CLIENT_SERVICE_OTHER ? (
                            <span className="badge badge-active">Locked</span>
                          ) : null}
                        </div>
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {LOCKED_SERVICE_IDS.has(service.id) ? (
                          <span className="muted" style={{ fontSize: '0.85rem' }}>
                            Locked
                          </span>
                        ) : (
                          <button
                            type="button"
                            className="btn btn-ghost service-catalog-remove-btn"
                            disabled={busy}
                            onClick={() => removeServiceRow(service.key, service.name)}
                          >
                            Remove
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="service-catalog-add-row" style={{ marginTop: '0.9rem' }}>
            <input
              className="service-catalog-input"
              value={newServiceName}
              onChange={(e) => setNewServiceName(e.target.value)}
              placeholder="Add a new service name"
              disabled={busy}
            />
            <button
              type="button"
              className="btn btn-ghost"
              disabled={busy || !newServiceName.trim()}
              onClick={addServiceRow}
            >
              Add service
            </button>
          </div>
          <button type="submit" className="btn btn-ghost" disabled={busy || loadingCatalog} style={{ marginTop: '0.9rem' }}>
            Save services
          </button>
        </form>
      </div>
    </Layout>
  );
}
