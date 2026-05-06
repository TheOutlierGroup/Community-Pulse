import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api.js';
import { useAuth } from '../components/shared/Auth.jsx';
import { useToast } from '../components/shared/ToastProvider.jsx';
import Layout from '../components/shared/Layout.jsx';
import AuthenticatedBlobImage from '../components/platform/AuthenticatedBlobImage.jsx';
import { isLicenseeUser, usePlatformAccess } from '../hooks/usePlatformAccess.js';
import { useDocumentTitle, DEFAULT_TAB } from '../hooks/useDocumentTitle.js';
import { Building2, Plus, X } from 'lucide-react';
import {
  clientServiceLabel,
  clientStatusBadgeClass,
  clientStatusLabel,
  normalizeServices,
} from './platformClientUtils.js';
import { CLIENT_SERVICE_LICENSEE } from '../utils/clientServices.js';

function activeServiceLabels(settings, serviceCatalog) {
  return normalizeServices(settings).map((serviceId) => clientServiceLabel(serviceId, serviceCatalog));
}

export default function PlatformClients() {
  const { user, logout, loading } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const ok = usePlatformAccess(user, loading, navigate);
  const [orgs, setOrgs] = useState([]);
  const [serviceCatalog, setServiceCatalog] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const isLicensee = isLicenseeUser(user);
  const canCreateLicensees = !isLicensee;

  const [modalOpen, setModalOpen] = useState(false);
  const [newOrgName, setNewOrgName] = useState('');
  const [newOrgAddress, setNewOrgAddress] = useState('');
  const [newOrgAdminEmail, setNewOrgAdminEmail] = useState('');
  const [newOrgAdminFirstName, setNewOrgAdminFirstName] = useState('');
  const [newOrgAdminLastName, setNewOrgAdminLastName] = useState('');
  const [sendWelcomeEmail, setSendWelcomeEmail] = useState(false);
  const [enableLogin, setEnableLogin] = useState(true);
  const [createAsLicensee, setCreateAsLicensee] = useState(false);
  const [newOrgLogo, setNewOrgLogo] = useState(null);

  const loadOrgs = useCallback(async () => {
    const { data } = await api.get('/api/platform/organizations');
    setOrgs(data.organizations || []);
  }, []);

  useEffect(() => {
    if (!ok) return;
    (async () => {
      try {
        setError('');
        const { data: orgsData } = await api.get('/api/platform/organizations');
        setOrgs(orgsData.organizations || []);
        try {
          const { data: servicesData } = await api.get('/api/platform/service-catalog');
          setServiceCatalog(servicesData.services || []);
        } catch {
          setServiceCatalog([]);
        }
      } catch (e) {
        setError(e.response?.data?.error || 'Failed to load companies.');
      }
    })();
  }, [ok]);

  useEffect(() => {
    if (!modalOpen) return;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setModalOpen(false);
        setError('');
        setNewOrgName('');
        setNewOrgAddress('');
        setNewOrgAdminEmail('');
        setNewOrgAdminFirstName('');
        setNewOrgAdminLastName('');
        setSendWelcomeEmail(false);
        setEnableLogin(true);
        setCreateAsLicensee(false);
        setNewOrgLogo(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [modalOpen]);

  useDocumentTitle(!loading && ok ? `Clients | ${DEFAULT_TAB}` : null);

  function closeCreateModal() {
    setModalOpen(false);
    setError('');
    setNewOrgName('');
    setNewOrgAddress('');
    setNewOrgAdminEmail('');
    setNewOrgAdminFirstName('');
    setNewOrgAdminLastName('');
    setSendWelcomeEmail(false);
    setEnableLogin(true);
    setCreateAsLicensee(false);
    setNewOrgLogo(null);
  }

  function openClient(orgId) {
    navigate(`/platform/clients/${orgId}`);
  }

  async function createOrg(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const fd = new FormData();
      fd.append('name', newOrgName.trim());
      if (newOrgAddress.trim()) fd.append('companyAddress', newOrgAddress.trim());
      if (newOrgAdminEmail.trim()) fd.append('adminEmail', newOrgAdminEmail.trim());
      if (newOrgAdminFirstName.trim()) fd.append('adminFirstName', newOrgAdminFirstName.trim());
      if (newOrgAdminLastName.trim()) fd.append('adminLastName', newOrgAdminLastName.trim());
      if (newOrgAdminEmail.trim() && !isLicensee) {
        fd.append('sendWelcomeEmail', sendWelcomeEmail ? 'true' : 'false');
        fd.append('enableLogin', enableLogin ? 'true' : 'false');
      }
      if (canCreateLicensees && createAsLicensee) {
        fd.append('clientServiceIds', JSON.stringify([CLIENT_SERVICE_LICENSEE]));
      }
      if (newOrgLogo) fd.append('logo', newOrgLogo);
      const { data } = await api.post('/api/platform/organizations', fd);
      await loadOrgs();
      const companyName = newOrgName.trim();
      let toastMsg = `${companyName} was added as a client company.`;
      let durationMs;
      if (data.firstUser) {
        toastMsg = `${companyName} was created.\n\nFirst admin: ${data.firstUser.email}`;
        if (data.welcomeEmailSent) {
          toastMsg +=
            '\n\nA welcome email was sent with a link to create their password.';
        } else if (data.welcomeEmailRequested) {
          toastMsg +=
            '\n\nWelcome email was not sent (check Resend and APP_URL). Login is enabled — they can use “Forgot password” on the sign-in page to set a password.';
          durationMs = 20000;
        } else if (data.firstUser.loginEnabled === false) {
          toastMsg +=
            '\n\nLogin is disabled for this user. They cannot sign in or use password reset until login is enabled for their account.';
        } else if (!sendWelcomeEmail) {
          toastMsg +=
            '\n\nThey can use “Forgot password” on the sign-in page to choose a password when you are ready.';
        }
      }
      showToast(toastMsg, { variant: 'success', durationMs });
      closeCreateModal();
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Could not create organization.');
    } finally {
      setBusy(false);
    }
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
          onClick={() => {
            setError('');
            setModalOpen(true);
          }}
        >
          <Plus size={20} strokeWidth={2} aria-hidden />
          Create company
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
            Add the first downstream company you'll deliver Rhythm Engine to. You can grant them platform
            access right away or set them up first and invite them later.
          </p>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              setError('');
              setModalOpen(true);
            }}
          >
            <Plus size={18} strokeWidth={2} aria-hidden />
            Create company
          </button>
        </div>
      )}

      <div className="card platform-users-card" style={{ marginBottom: '1.5rem' }}>
        <div className="table-wrap">
          <table className="admin-table platform-clients-table">
            <thead>
              <tr>
                <th scope="col">Company</th>
                <th scope="col">Status</th>
                <th scope="col">Active services</th>
                <th scope="col">Created</th>
              </tr>
            </thead>
            <tbody>
              {orgs.length === 0 && (
                <tr>
                  <td colSpan={4} className="muted" style={{ padding: '1.5rem', textAlign: 'center' }}>
                    {isLicensee
                      ? 'No client companies yet — use the prompt above to create your first one.'
                      : 'No client companies yet. Create one to get started.'}
                  </td>
                </tr>
              )}
              {orgs.map((o) => (
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
                    <span className={`badge badge-${clientStatusBadgeClass(o.client_status)}`}>
                      {clientStatusLabel(o.client_status)}
                    </span>
                  </td>
                  <td className="muted" style={{ fontSize: '0.9rem' }}>
                    {activeServiceLabels(o.settings, serviceCatalog).join(', ') || '—'}
                  </td>
                  <td className="muted" style={{ fontSize: '0.9rem' }}>
                    {o.created_at
                      ? new Date(o.created_at).toLocaleDateString(undefined, {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                        })
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {modalOpen && (
        <div className="modal-backdrop" role="presentation" onClick={closeCreateModal}>
          <div
            className="modal-dialog modal-dialog--wide card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-company-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-dialog__head">
              <h2 id="create-company-title" style={{ margin: 0, fontSize: '1.15rem' }}>
                Create company
              </h2>
              <button
                type="button"
                className="btn btn-ghost modal-dialog__close"
                onClick={closeCreateModal}
                aria-label="Close"
              >
                <X size={22} aria-hidden />
              </button>
            </div>
            {error && modalOpen && <p className="error" style={{ marginBottom: '1rem' }}>{error}</p>}
            <form onSubmit={createOrg}>
              <div className="field">
                <label htmlFor="cname">Company name</label>
                <input
                  id="cname"
                  value={newOrgName}
                  onChange={(e) => setNewOrgName(e.target.value)}
                  required
                  autoComplete="off"
                />
              </div>
              <div className="field">
                <label htmlFor="c-address">Address (optional)</label>
                <textarea
                  id="c-address"
                  value={newOrgAddress}
                  onChange={(e) => setNewOrgAddress(e.target.value)}
                  rows={3}
                  className="platform-textarea"
                  placeholder="Street, city, region, postcode, country"
                  autoComplete="street-address"
                />
              </div>
              <div className="field">
                <label htmlFor="aemail">First admin email (optional)</label>
                <input
                  id="aemail"
                  type="email"
                  value={newOrgAdminEmail}
                  onChange={(e) => setNewOrgAdminEmail(e.target.value)}
                  placeholder="admin@client.com"
                  autoComplete="off"
                />
                <p className="muted" style={{ fontSize: '0.8rem', marginTop: '0.35rem' }}>
                  If set, we create this user as a company admin (no invite link).
                </p>
              </div>
              <fieldset className="modal-dialog__fieldset">
                <legend>First admin name (optional)</legend>
                <div className="modal-dialog__name-row">
                  <div className="field">
                    <label htmlFor="afirst">First name</label>
                    <input
                      id="afirst"
                      value={newOrgAdminFirstName}
                      onChange={(e) => setNewOrgAdminFirstName(e.target.value)}
                      autoComplete="given-name"
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="alast">Last name</label>
                    <input
                      id="alast"
                      value={newOrgAdminLastName}
                      onChange={(e) => setNewOrgAdminLastName(e.target.value)}
                      autoComplete="family-name"
                    />
                  </div>
                </div>
              </fieldset>
              {!isLicensee ? (
                <div className="field">
                  <p className="muted" style={{ fontSize: '0.85rem', margin: '0 0 0.5rem' }}>
                    First admin options (when email is set)
                  </p>
                  <label
                    style={{ display: 'flex', alignItems: 'flex-start', gap: '0.6rem', padding: '0.35rem 0' }}
                  >
                    <input
                      type="checkbox"
                      checked={sendWelcomeEmail}
                      disabled={busy}
                      onChange={(e) => {
                        const on = e.target.checked;
                        setSendWelcomeEmail(on);
                        if (on) setEnableLogin(true);
                      }}
                    />
                    <span>
                      Send welcome email
                      <span className="muted" style={{ display: 'block', fontSize: '0.8rem', marginTop: '0.2rem' }}>
                        Sends a link to create their password. Also turns on login.
                      </span>
                    </span>
                  </label>
                  <label
                    style={{ display: 'flex', alignItems: 'flex-start', gap: '0.6rem', padding: '0.35rem 0' }}
                  >
                    <input
                      type="checkbox"
                      checked={enableLogin}
                      disabled={busy || sendWelcomeEmail}
                      onChange={(e) => setEnableLogin(e.target.checked)}
                    />
                    <span>
                      Enable login
                      <span className="muted" style={{ display: 'block', fontSize: '0.8rem', marginTop: '0.2rem' }}>
                        If off, they cannot sign in or use password reset and have no access to the platform.
                      </span>
                    </span>
                  </label>
                </div>
              ) : null}
              {canCreateLicensees && (
                <div className="field">
                  <p className="muted" style={{ fontSize: '0.85rem', margin: '0 0 0.5rem' }}>
                    Licensing
                  </p>
                  <label
                    style={{ display: 'flex', alignItems: 'flex-start', gap: '0.6rem', padding: '0.35rem 0' }}
                  >
                    <input
                      type="checkbox"
                      checked={createAsLicensee}
                      disabled={busy}
                      onChange={(e) => setCreateAsLicensee(e.target.checked)}
                    />
                    <span>
                      Rhythm Engine Licensee
                      <span className="muted" style={{ display: 'block', fontSize: '0.8rem', marginTop: '0.2rem' }}>
                        License this company to run their own Rhythm Engine workspace and manage their
                        own client companies.
                      </span>
                    </span>
                  </label>
                </div>
              )}
              <div className="field">
                <label htmlFor="c-logo">Company logo (optional)</label>
                <input
                  id="c-logo"
                  type="file"
                  accept="image/jpeg,image/png,image/gif,image/webp"
                  onChange={(e) => setNewOrgLogo(e.target.files?.[0] || null)}
                />
                <p className="muted" style={{ fontSize: '0.8rem', marginTop: '0.35rem' }}>
                  JPG, PNG, GIF, or WebP, up to 2&nbsp;MB.
                </p>
              </div>
              <div className="modal-dialog__actions">
                <button type="button" className="btn btn-ghost" onClick={closeCreateModal} disabled={busy}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary modal-dialog__submit" disabled={busy}>
                  {busy ? 'Creating…' : 'Create company'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </Layout>
  );
}
