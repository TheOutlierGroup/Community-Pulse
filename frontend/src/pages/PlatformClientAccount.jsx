import { useEffect, useRef, useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import api from '../services/api.js';
import { useAuth } from '../components/shared/Auth.jsx';
import { useToast } from '../components/shared/ToastProvider.jsx';
import ModalDialog from '../components/shared/ModalDialog.jsx';
import PlatformClientHeader from './PlatformClientHeader.jsx';
import { Building2, Sparkles, Trash2 } from 'lucide-react';
import LicenseConfigPanel from '../components/platform/LicenseConfigPanel.jsx';
import { isWorkspaceUser, isEnterpriseClientSelfUser } from '../hooks/usePlatformAccess.js';
import {
  CLIENT_SERVICE_LICENSEE,
  CLIENT_SERVICE_OTHER,
  CLIENT_SERVICE_PULSE,
  CURRENT_PREVIOUS_OPTIONS,
  RELATIONSHIP_STATUS_OPTIONS,
  clientStatusLabel,
  normalizeServices,
  normalizeClientStatus,
  normalizeRelationshipStatus,
} from './platformClientUtils.js';
import '../styles/crm.css';

function readClientSettings(settings) {
  if (settings == null) return null;
  let s = settings;
  if (typeof s === 'string') {
    try {
      s = JSON.parse(s);
    } catch {
      return null;
    }
  }
  if (!s || typeof s !== 'object' || Array.isArray(s)) return null;
  return s;
}

function readCompanyAddress(settings) {
  const parsed = readClientSettings(settings);
  if (!parsed) return '';
  const v = parsed.companyAddress;
  return v == null ? '' : String(v);
}

export default function PlatformClientAccount() {
  const { org, orgId, refreshOrg, licenseConfig, clientLogoUrl, bumpClientLogo } =
    useOutletContext();
  const { user } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const isPlatformAdmin =
    user?.organizationKind === 'platform' && user?.role === 'admin';
  const isWorkspace = isWorkspaceUser(user);
  const isSelfService = isEnterpriseClientSelfUser(user);
  const isLicenseeOrg = org.kind === 'licensee';
  // A standalone "Enterprise" client (no Practitioner parent) carries its
  // own Rhythm Engine licence directly, same panel as a Practitioner uses
  // for itself — a plain client with no Rhythm Engine service never shows
  // this, matching today's behaviour.
  const isEnterpriseClient =
    org.kind === 'client'
    && !org.parent_organization_id
    && normalizeServices(org.settings).includes(CLIENT_SERVICE_PULSE);
  const logoInputRef = useRef(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const isLegacyClientStatus = (status) =>
    !CURRENT_PREVIOUS_OPTIONS.some((option) => option.id === status);
  const initialStatus = normalizeClientStatus(org.client_status);
  const [editName, setEditName] = useState(org.name);
  const [clientStatus, setClientStatus] = useState(() =>
    isLegacyClientStatus(initialStatus) ? CURRENT_PREVIOUS_OPTIONS[0].id : initialStatus
  );
  const [relationshipStatus, setRelationshipStatus] = useState(() => normalizeRelationshipStatus(org.relationship_status));
  const [address, setAddress] = useState(() => readCompanyAddress(org.settings));
  const [serviceCatalog, setServiceCatalog] = useState([]);
  const [selectedServices, setSelectedServices] = useState(() =>
    normalizeServices(org.settings).filter((id) => id !== CLIENT_SERVICE_LICENSEE)
  );
  const [otherServiceDisplayValue, setOtherServiceDisplayValue] = useState('');
  const [clientPortalTier, setClientPortalTier] = useState(() => org.settings?.clientPortalTier === 'enterprise' ? 'enterprise' : 'standard');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const normalizedStatus = normalizeClientStatus(org.client_status);
    setEditName(org.name);
    setClientStatus(isLegacyClientStatus(normalizedStatus) ? CURRENT_PREVIOUS_OPTIONS[0].id : normalizedStatus);
    setRelationshipStatus(normalizeRelationshipStatus(org.relationship_status));
    setAddress(readCompanyAddress(org.settings));
    setSelectedServices(normalizeServices(org.settings).filter((id) => id !== CLIENT_SERVICE_LICENSEE));
    setOtherServiceDisplayValue('');
    setClientPortalTier(org.settings?.clientPortalTier === 'enterprise' ? 'enterprise' : 'standard');
  }, [org.name, org.client_status, org.relationship_status, org.settings]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get('/api/platform/service-catalog');
        if (!cancelled) setServiceCatalog(Array.isArray(data.services) ? data.services : []);
      } catch {
        if (!cancelled) setServiceCatalog([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function saveOrgName(e) {
    e.preventDefault();
    if (!confirm('Save changes to this client’s name?')) return;
    setBusy(true);
    setError('');
    try {
      await api.patch(`/api/platform/organizations/${orgId}`, { name: editName.trim() });
      await refreshOrg();
      showToast('Client name saved.', { variant: 'success' });
    } catch (err) {
      setError(err.response?.data?.error || 'Could not update client.');
    } finally {
      setBusy(false);
    }
  }

  async function saveAddress(e) {
    e.preventDefault();
    if (!confirm('Save changes to this client’s address?')) return;
    setBusy(true);
    setError('');
    try {
      await api.patch(`/api/platform/organizations/${orgId}`, {
        settings: { companyAddress: address.trim() },
      });
      await refreshOrg();
      showToast('Address saved.', { variant: 'success' });
    } catch (err) {
      setError(err.response?.data?.error || 'Could not save address.');
    } finally {
      setBusy(false);
    }
  }

  async function saveServices(e) {
    e.preventDefault();
    if (!confirm('Save changes to this client’s services?')) return;
    setBusy(true);
    setError('');
    try {
      await api.patch(`/api/platform/organizations/${orgId}`, {
        settings: { services: selectedServices },
      });
      await refreshOrg();
      showToast('Services saved.', { variant: 'success' });
    } catch (err) {
      setError(err.response?.data?.error || 'Could not save services.');
    } finally {
      setBusy(false);
    }
  }

  async function saveClientPortalTier(e) {
    e.preventDefault();
    if (!confirm('Save changes to this client’s portal access tier?')) return;
    setBusy(true);
    setError('');
    try {
      await api.patch(`/api/platform/organizations/${orgId}`, {
        settings: { clientPortalTier },
      });
      await refreshOrg();
      showToast('Portal access tier saved.', { variant: 'success' });
    } catch (err) {
      setError(err.response?.data?.error || 'Could not save portal access tier.');
    } finally {
      setBusy(false);
    }
  }

  async function saveClientStatus(e) {
    e.preventDefault();
    if (!confirm('Save changes to this client’s status?')) return;
    setBusy(true);
    setError('');
    try {
      await api.patch(`/api/platform/organizations/${orgId}`, {
        clientStatus,
        relationshipStatus,
      });
      await refreshOrg();
      showToast('Status saved.', { variant: 'success' });
    } catch (err) {
      setError(err.response?.data?.error || 'Could not save status.');
    } finally {
      setBusy(false);
    }
  }

  function toggleService(serviceId) {
    const id = String(serviceId || '').trim().toLowerCase();
    if (!id) return;
    setSelectedServices((current) => {
      if (current.includes(id)) {
        if (id === CLIENT_SERVICE_OTHER) setOtherServiceDisplayValue('');
        return current.filter((service) => service !== id);
      }
      return [...current, id];
    });
  }

  async function onCompanyLogoFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!confirm('Save changes to this client’s logo?')) return;
    setBusy(true);
    setError('');
    try {
      const fd = new FormData();
      fd.append('logo', file);
      await api.post(`/api/platform/organizations/${orgId}/logo`, fd);
      await refreshOrg();
      bumpClientLogo();
      showToast('Client logo updated.', { variant: 'success' });
    } catch (err) {
      showToast(err.response?.data?.error || 'Could not upload logo.', { variant: 'error' });
    } finally {
      setBusy(false);
    }
  }

  async function removeClientLogo() {
    if (!confirm('Remove this client’s logo?')) return;
    setBusy(true);
    setError('');
    try {
      await api.delete(`/api/platform/organizations/${orgId}/logo`);
      await refreshOrg();
      bumpClientLogo();
      showToast('Client logo removed.', { variant: 'success' });
    } catch (err) {
      showToast(err.response?.data?.error || 'Could not remove logo.', { variant: 'error' });
    } finally {
      setBusy(false);
    }
  }

  async function deleteClient() {
    if (deleteConfirmText.trim().toLowerCase() !== 'delete') return;
    setDeleting(true);
    try {
      await api.delete(`/api/platform/organizations/${orgId}`);
      showToast('Client deleted.', { variant: 'success' });
      navigate('/platform/clients', { replace: true });
    } catch (err) {
      setError(err.response?.data?.error || 'Could not delete client.');
      setDeleting(false);
      setShowDeleteConfirm(false);
    }
  }

  async function downloadProspectSnapshot() {
    setError('');
    try {
      const response = await api.get(
        `/api/platform/organizations/${orgId}/prospect-snapshot.csv`,
        { responseType: 'blob' }
      );
      const fallbackName = `${org.name}-prospect-history.csv`;
      const disposition = String(response.headers?.['content-disposition'] || '');
      const match = disposition.match(/filename="?([^"]+)"?/i);
      const filename = match?.[1] || fallbackName;
      const blobUrl = window.URL.createObjectURL(new Blob([response.data], { type: 'text/csv' }));
      const anchor = document.createElement('a');
      anchor.href = blobUrl;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(blobUrl);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not download prospect history.');
    }
  }

  return (
    <>
      <PlatformClientHeader orgName={org.name} logoSrc={clientLogoUrl} />
      {error && <p className="error" style={{ marginBottom: '1rem' }}>{error}</p>}
      {(isLicenseeOrg || isEnterpriseClient) && isPlatformAdmin && (
        <LicenseConfigPanel
          orgId={orgId}
          licenseConfig={licenseConfig}
          onSaved={refreshOrg}
          isPractitioner={isLicenseeOrg}
        />
      )}
      {isEnterpriseClient && isSelfService && user?.role === 'admin' && (
        <LicenseConfigPanel orgId={orgId} licenseConfig={licenseConfig} selfServiceView />
      )}
      <div className="platform-client-dashboard-grid">
        {isWorkspace && (
        <div className="card platform-client-dashboard__card">
          <h1 className="platform-client-dashboard__h2" style={{ marginTop: 0 }}>
            Configurations
          </h1>
          <p className="muted" style={{ marginTop: '-0.25rem', marginBottom: '1.25rem' }}>
            Client profile for this client workspace. Admins see the logo in their account, too.
          </p>

          <h2 className="platform-client-dashboard__h2">Client</h2>
          <form onSubmit={saveOrgName}>
            <div className="field">
              <label htmlFor="acct-ename">Client name</label>
              <input
                id="acct-ename"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                required
              />
            </div>
            <button type="submit" className="btn btn-ghost" disabled={busy}>
              Save name
            </button>
          </form>

          <form
            onSubmit={saveClientStatus}
            style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--border)' }}
          >
            {isLegacyClientStatus(initialStatus) ? (
              <p className="muted" style={{ fontSize: '0.85rem', marginTop: 0 }}>
                Currently: {clientStatusLabel(org.client_status)} (legacy status — pick Current or
                Previous below to update).
              </p>
            ) : null}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <div className="field">
                <label htmlFor="acct-client-status">Status</label>
                <select
                  id="acct-client-status"
                  value={clientStatus}
                  onChange={(e) => setClientStatus(normalizeClientStatus(e.target.value))}
                  disabled={busy}
                >
                  {CURRENT_PREVIOUS_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="acct-relationship-status">Relationship Status</label>
                <select
                  id="acct-relationship-status"
                  value={relationshipStatus}
                  onChange={(e) => setRelationshipStatus(e.target.value)}
                  disabled={busy}
                >
                  {RELATIONSHIP_STATUS_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <button type="submit" className="btn btn-ghost" disabled={busy}>
              Save status
            </button>
          </form>

          {isPlatformAdmin && !isEnterpriseClient && (
            <form
              onSubmit={saveClientPortalTier}
              style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--border)' }}
            >
              <h2 className="platform-client-dashboard__h2">Portal access</h2>
              <p className="muted" style={{ fontSize: '0.9rem', marginTop: 0 }}>
                Enterprise gives this client&rsquo;s own admins/employees self-service access to their
                Dashboard, Users, Tasks, and Rhythm Engine — separate from which services are enabled below.
              </p>
              <div className="field">
                <label htmlFor="acct-portal-tier">Client portal tier</label>
                <select
                  id="acct-portal-tier"
                  value={clientPortalTier}
                  onChange={(e) => setClientPortalTier(e.target.value)}
                  disabled={busy}
                >
                  <option value="standard">Guided</option>
                  <option value="enterprise">Enterprise</option>
                </select>
              </div>
              <button type="submit" className="btn btn-ghost" disabled={busy}>
                Save portal access
              </button>
            </form>
          )}

          <form onSubmit={saveServices} style={{ marginTop: '1.25rem', paddingTop: '1.25rem', borderTop: '1px solid var(--border)' }}>
            <h2 className="platform-client-dashboard__h2">Services</h2>
            <p className="muted" style={{ fontSize: '0.9rem', marginTop: 0 }}>
              Select the services enabled for this client.
            </p>
            <div style={{ display: 'grid', gap: '0.45rem' }}>
              {(() => {
                // Rhythm Engine Licensee only ever takes effect at company
                // creation time (it flips a new org into a licensee tenant).
                // An existing client's kind can't change here, so offering
                // it as a toggle would silently do nothing.
                const assignableServices = serviceCatalog.filter(
                  (service) => service.id !== CLIENT_SERVICE_LICENSEE
                );
                if (assignableServices.length === 0) {
                  return (
                    <p className="muted" style={{ margin: 0 }}>
                      No services have been defined in platform settings yet.
                    </p>
                  );
                }
                return assignableServices.map((service) => (
                  <label key={service.id} style={{ display: 'flex', alignItems: 'center', gap: '0.55rem' }}>
                    <input
                      type="checkbox"
                      checked={selectedServices.includes(service.id)}
                      onChange={() => toggleService(service.id)}
                      disabled={busy}
                    />
                    <span>{service.name}</span>
                  </label>
                ));
              })()}
            </div>
            {selectedServices.includes(CLIENT_SERVICE_OTHER) ? (
              <div className="field" style={{ marginTop: '0.9rem' }}>
                <label htmlFor="acct-service-other">Other service name</label>
                <input
                  id="acct-service-other"
                  value={otherServiceDisplayValue}
                  onChange={(e) => setOtherServiceDisplayValue(e.target.value)}
                  disabled={busy}
                />
              </div>
            ) : null}
            <button type="submit" className="btn btn-ghost" disabled={busy} style={{ marginTop: '0.9rem' }}>
              Save services
            </button>
          </form>

        </div>
        )}

        <div
          className="card platform-client-dashboard__card"
          style={!isWorkspace ? { gridColumn: '1 / -1', maxWidth: 640 } : undefined}
        >
          <h2 className="platform-client-dashboard__h2" style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Building2 size={20} strokeWidth={1.75} aria-hidden />
            Client logo
          </h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
            <div className="company-logo-preview-wrap" style={{ marginBottom: 0 }}>
              {clientLogoUrl ? (
                <img src={clientLogoUrl} alt="" className="company-logo-preview" />
              ) : (
                <span className="muted" style={{ fontSize: '0.9rem' }}>
                  No logo yet.
                </span>
              )}
            </div>
            <input
              ref={logoInputRef}
              type="file"
              accept="image/jpeg,image/png,image/gif,image/webp"
              className="visually-hidden"
              onChange={onCompanyLogoFile}
              disabled={busy}
            />
            <div className="btn-row" style={{ marginTop: 0 }}>
              <button
                type="button"
                className="btn btn-primary platform-inline-primary"
                disabled={busy}
                onClick={() => logoInputRef.current?.click()}
              >
                <Sparkles size={18} strokeWidth={1.75} aria-hidden style={{ marginRight: '0.35rem' }} />
                {busy ? 'Working…' : org.company_logo_filename ? 'Change logo' : 'Upload logo'}
              </button>
              {org.company_logo_filename ? (
                <button type="button" className="btn btn-ghost" disabled={busy} onClick={removeClientLogo}>
                  Remove logo
                </button>
              ) : null}
            </div>
          </div>
          <p className="muted" style={{ fontSize: '0.8rem', marginTop: '0.5rem', marginBottom: 0 }}>
            Shown in the client workspace header and in client accounts for their admins. JPG, PNG, GIF, or
            WebP, up to 2&nbsp;MB.
          </p>

          {isWorkspace ? (
            <form onSubmit={saveAddress} style={{ marginTop: '1.25rem', paddingTop: '1.25rem', borderTop: '1px solid var(--border)' }}>
              <h2 className="platform-client-dashboard__h2">Address</h2>
              <p className="muted" style={{ fontSize: '0.9rem', marginTop: 0 }}>
                Business or mailing address for your records.
              </p>
              <div className="field">
                <label htmlFor="acct-address">Street, city, region, postcode, country</label>
                <textarea
                  id="acct-address"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  rows={4}
                  className="platform-textarea"
                  placeholder="e.g. 123 Example St&#10;Sydney NSW 2000&#10;Australia"
                />
              </div>
              <button type="submit" className="btn btn-ghost" disabled={busy}>
                Save address
              </button>
            </form>
          ) : (
            // Read-only for self-service — editing goes through
            // PATCH /organizations/:id, which is intentionally staff-only
            // (it's also where clientPortalTier itself gets set).
            <div style={{ marginTop: '1.25rem', paddingTop: '1.25rem', borderTop: '1px solid var(--border)' }}>
              <h2 className="platform-client-dashboard__h2">Address</h2>
              <p className="muted" style={{ fontSize: '0.9rem', marginTop: '0.5rem', whiteSpace: 'pre-line' }}>
                {address || 'Not set. Contact Outlier to update this.'}
              </p>
            </div>
          )}

          <div style={{ marginTop: '1.25rem', paddingTop: '1.25rem', borderTop: '1px solid var(--border)' }}>
            <h2 className="platform-client-dashboard__h2">Workspace metadata</h2>
            <p className="muted" style={{ marginTop: '0.5rem', fontSize: '0.85rem', marginBottom: 0 }}>
              Created{' '}
              {org.created_at
                ? new Date(org.created_at).toLocaleDateString(undefined, {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  })
                : '—'}
            </p>
          </div>

          {/* Internal CRM sales/lead notes from before this client was
              promoted from a prospect — not shown to the client themselves,
              even though the rest of this card is. */}
          {org.prospect_snapshot && isWorkspace ? (
            <div style={{ marginTop: '1.25rem', paddingTop: '1.25rem', borderTop: '1px solid var(--border)' }}>
              <h2 className="platform-client-dashboard__h2">Prospect history</h2>
              <p className="muted" style={{ fontSize: '0.85rem', marginTop: '0.5rem', marginBottom: '0.75rem' }}>
                A static record of this client's details, notes, and activity from before it was
                promoted from a prospect. Not updated after promotion.
              </p>
              <button type="button" className="btn btn-ghost" onClick={downloadProspectSnapshot}>
                Download prospect history (CSV)
              </button>
            </div>
          ) : null}
        </div>

      </div>

      {isWorkspace && (
      <div
        className="card"
        style={{
          marginTop: '2rem',
          borderColor: 'var(--danger, #dc3545)',
          borderWidth: '1px',
          borderStyle: 'solid',
        }}
      >
        <p className="muted" style={{ fontSize: '0.9rem', marginTop: 0 }}>
          Permanently delete this client and all associated data including users, pulse sessions, tasks, and invites. This action cannot be undone.
        </p>
        <button
          type="button"
          className="btn"
          style={{
            backgroundColor: 'var(--danger, #dc3545)',
            color: '#fff',
            border: 'none',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.4rem',
          }}
          onClick={() => setShowDeleteConfirm(true)}
          disabled={busy}
        >
          <Trash2 size={16} strokeWidth={1.75} aria-hidden />
          Delete client
        </button>
      </div>
      )}

      <ModalDialog
        open={showDeleteConfirm}
        title="Delete client"
        titleId="delete-client-modal-title"
        onClose={() => {
          if (!deleting) {
            setShowDeleteConfirm(false);
            setDeleteConfirmText('');
          }
        }}
        dialogClassName=""
      >
        <div style={{ padding: '1rem 1.25rem' }}>
          <p style={{ margin: '0 0 0.75rem' }}>
            This will permanently delete <strong>{org.name}</strong> and all linked data including users, pulse sessions, tasks, comments, invites, and reports.
          </p>
          <p style={{ margin: '0 0 1rem', fontWeight: 600, color: 'var(--danger, #dc3545)' }}>
            This action cannot be undone.
          </p>
          <div className="field">
            <label htmlFor="delete-confirm-input">
              Type <strong>delete</strong> to confirm
            </label>
            <input
              id="delete-confirm-input"
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              placeholder="delete"
              autoComplete="off"
              disabled={deleting}
            />
          </div>
          <div className="btn-row" style={{ marginTop: '1rem' }}>
            <button
              type="button"
              className="btn"
              style={{
                backgroundColor: 'var(--danger, #dc3545)',
                color: '#fff',
                border: 'none',
              }}
              disabled={deleting || deleteConfirmText.trim().toLowerCase() !== 'delete'}
              onClick={deleteClient}
            >
              {deleting ? 'Deleting…' : 'Permanently delete'}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setShowDeleteConfirm(false);
                setDeleteConfirmText('');
              }}
              disabled={deleting}
            >
              Cancel
            </button>
          </div>
        </div>
      </ModalDialog>
    </>
  );
}
