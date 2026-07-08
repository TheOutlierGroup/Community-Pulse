import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api.js';
import { useAuth } from '../components/shared/Auth.jsx';
import { useToast } from '../components/shared/ToastProvider.jsx';
import Layout from '../components/shared/Layout.jsx';
import AuthenticatedBlobImage from '../components/platform/AuthenticatedBlobImage.jsx';
import NewClientModal from '../components/platform/NewClientModal.jsx';
import { isLicenseeUser, usePlatformAccess } from '../hooks/usePlatformAccess.js';
import { useDocumentTitle, DEFAULT_TAB } from '../hooks/useDocumentTitle.js';
import { Building2, ChevronDown, ChevronUp, ChevronsUpDown, Plus } from 'lucide-react';
import {
  clientCompositeStatusLabel,
  clientServiceLabel,
  normalizeServices,
  relationshipStatusBadgeClass,
} from './platformClientUtils.js';
import '../styles/crm.css';

function activeServiceLabels(settings, serviceCatalog) {
  return normalizeServices(settings).map((serviceId) => clientServiceLabel(serviceId, serviceCatalog));
}

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}

// Same 3-state sort cycle as the Prospects table: default -> ascending ->
// descending -> default, where "default" always renders most-recently-
// updated-first regardless of which column was last explicitly sorted.
const SORTABLE_COLUMNS = {
  client: (o) => String(o.name || ''),
  updated: (o) => new Date(o.updated_at || o.created_at || 0).getTime(),
};

function nextSortState(current, column) {
  if (current.column !== column) return { column, direction: 'asc' };
  if (current.direction === 'asc') return { column, direction: 'desc' };
  return { column: null, direction: null };
}

function effectiveSort(sort) {
  return sort.column
    ? { column: sort.column, direction: sort.direction }
    : { column: 'updated', direction: 'desc' };
}

function sortIndicator(sort, column) {
  const eff = effectiveSort(sort);
  if (eff.column !== column) {
    return <ChevronsUpDown size={14} strokeWidth={2} className="crm-table__sort-icon crm-table__sort-icon--inactive" aria-hidden />;
  }
  return eff.direction === 'asc'
    ? <ChevronUp size={14} strokeWidth={2.25} className="crm-table__sort-icon" aria-hidden />
    : <ChevronDown size={14} strokeWidth={2.25} className="crm-table__sort-icon" aria-hidden />;
}

function ariaSortFor(sort, column) {
  const eff = effectiveSort(sort);
  if (eff.column !== column) return 'none';
  return eff.direction === 'asc' ? 'ascending' : 'descending';
}

export default function PlatformClients() {
  const { user, logout, loading } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const ok = usePlatformAccess(user, loading, navigate);
  const [orgs, setOrgs] = useState([]);
  const [serviceCatalog, setServiceCatalog] = useState([]);
  const [error, setError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [sort, setSort] = useState({ column: null, direction: null });

  const isLicensee = isLicenseeUser(user);
  const canCreateLicensees = !isLicensee;

  const loadOrgs = useCallback(async () => {
    const { data } = await api.get('/api/platform/organizations');
    setOrgs(data.organizations || []);
  }, []);

  useEffect(() => {
    if (!ok) return;
    (async () => {
      try {
        setError('');
        await loadOrgs();
        try {
          const { data: servicesData } = await api.get('/api/platform/service-catalog');
          setServiceCatalog(servicesData.services || []);
        } catch {
          setServiceCatalog([]);
        }
      } catch (e) {
        setError(e.response?.data?.error || 'Failed to load clients.');
      }
    })();
  }, [ok, loadOrgs]);

  useDocumentTitle(!loading && ok ? `Clients | ${DEFAULT_TAB}` : null);

  function toggleSort(column) {
    setSort((current) => nextSortState(current, column));
  }

  const sortedOrgs = useMemo(() => {
    const eff = effectiveSort(sort);
    const dirMultiplier = eff.direction === 'asc' ? 1 : -1;
    const getValue = SORTABLE_COLUMNS[eff.column];
    return [...orgs].sort((a, b) => {
      const av = getValue(a);
      const bv = getValue(b);
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dirMultiplier;
      return String(av).localeCompare(String(bv), undefined, { sensitivity: 'base' }) * dirMultiplier;
    });
  }, [orgs, sort]);

  function openClient(orgId) {
    navigate(`/platform/clients/${orgId}`);
  }

  async function handleCreated(data) {
    await loadOrgs();
    const clientName = data.organization?.name || '';
    let toastMsg = `${clientName} was added as a client.`;
    let durationMs;
    if (data.firstUser) {
      toastMsg = `${clientName} was created.\n\nFirst admin: ${data.firstUser.email}`;
      if (data.welcomeEmailSent) {
        toastMsg += '\n\nA welcome email was sent with a link to create their password.';
      } else if (data.welcomeEmailRequested) {
        toastMsg +=
          '\n\nWelcome email was not sent (check Resend and APP_URL). Login is enabled — they can use “Forgot password” on the sign-in page to set a password.';
        durationMs = 20000;
      } else if (data.firstUser.loginEnabled === false) {
        toastMsg +=
          '\n\nLogin is disabled for this user. They cannot sign in or use password reset until login is enabled for their account.';
      } else {
        toastMsg += '\n\nThey can use “Forgot password” on the sign-in page to choose a password when you are ready.';
      }
    }
    showToast(toastMsg, { variant: 'success', durationMs });
    setModalOpen(false);
  }

  if (loading || !ok) return null;

  return (
    <Layout user={user} onLogout={logout}>
      <div className="page-header-row">
        <div>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0 }}>
            <Building2 size={28} strokeWidth={1.75} aria-hidden />
            Clients
          </h1>
        </div>
        <button
          type="button"
          className="btn btn-primary platform-header-cta"
          onClick={() => setModalOpen(true)}
        >
          <Plus size={20} strokeWidth={2} aria-hidden />
          New Client
        </button>
      </div>

      {error && !modalOpen && <p className="error" style={{ marginBottom: '1rem' }}>{error}</p>}

      {isLicensee && orgs.length === 0 && (
        <div
          className="card"
          style={{
            marginBottom: '1.5rem',
            background: 'linear-gradient(135deg, #fff7ed 0%, #ffffff 60%)',
            border: '1px solid #fed7aa',
            padding: '2rem 1.5rem',
            textAlign: 'center',
          }}
        >
          <Building2 size={36} strokeWidth={1.5} aria-hidden style={{ color: '#ea580c', marginBottom: '0.5rem' }} />
          <h2 style={{ margin: '0 0 0.5rem', fontSize: '1.2rem' }}>Create your first client</h2>
          <p className="muted" style={{ maxWidth: 480, margin: '0 auto 1rem', fontSize: '0.95rem' }}>
            Add the first downstream client you'll deliver Rhythm Engine to. You can grant them platform
            access right away or set them up first and invite them later.
          </p>
          <button type="button" className="btn btn-primary" onClick={() => setModalOpen(true)}>
            <Plus size={18} strokeWidth={2} aria-hidden />
            New Client
          </button>
        </div>
      )}

      <div className="card platform-users-card" style={{ marginBottom: '1.5rem' }}>
        <div className="table-wrap">
          <table className="admin-table platform-clients-table">
            <thead>
              <tr>
                <th scope="col" aria-sort={ariaSortFor(sort, 'client')}>
                  <button type="button" className="crm-table__sort-btn" onClick={() => toggleSort('client')}>
                    Client {sortIndicator(sort, 'client')}
                  </button>
                </th>
                <th scope="col">Status</th>
                <th scope="col">Active services</th>
                <th scope="col" aria-sort={ariaSortFor(sort, 'updated')}>
                  <button type="button" className="crm-table__sort-btn" onClick={() => toggleSort('updated')}>
                    Last Updated {sortIndicator(sort, 'updated')}
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {orgs.length === 0 && (
                <tr>
                  <td colSpan={4} className="muted" style={{ padding: '1.5rem', textAlign: 'center' }}>
                    {isLicensee
                      ? 'No clients yet — use the prompt above to create your first one.'
                      : 'No clients yet. Create one to get started.'}
                  </td>
                </tr>
              )}
              {sortedOrgs.map((o) => (
                <tr
                  key={o.id}
                  className="platform-clients-table__row platform-clients-table__row--clickable"
                  tabIndex={0}
                  role="button"
                  aria-label={`Open ${o.name}`}
                  onClick={() => openClient(o.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      openClient(o.id);
                    }
                  }}
                >
                  <td>
                    <div className="platform-clients-table__company-cell">
                      {o.company_logo_filename ? (
                        <span className="platform-clients-table__logo-slot" aria-hidden>
                          <AuthenticatedBlobImage
                            path={`/api/platform/organizations/${o.id}/logo`}
                            alt=""
                            className="platform-clients-table__logo"
                          />
                        </span>
                      ) : null}
                      <span className="platform-users-table__name">{o.name}</span>
                      {o.kind === 'licensee' && (
                        <span className="badge badge-active" style={{ marginLeft: '0.5rem' }}>
                          Licensee
                        </span>
                      )}
                    </div>
                  </td>
                  <td>
                    <span className={`badge ${relationshipStatusBadgeClass(o.relationship_status)}`}>
                      {clientCompositeStatusLabel(o.client_status, o.relationship_status)}
                    </span>
                  </td>
                  <td className="muted" style={{ fontSize: '0.9rem' }}>
                    {activeServiceLabels(o.settings, serviceCatalog).join(', ') || '—'}
                  </td>
                  <td className="muted" style={{ fontSize: '0.9rem' }}>
                    {fmtDate(o.updated_at || o.created_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <NewClientModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={handleCreated}
        isLicensee={isLicensee}
        canCreateLicensees={canCreateLicensees}
      />
    </Layout>
  );
}
