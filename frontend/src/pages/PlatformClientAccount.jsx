import { useEffect, useRef, useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import api from '../services/api.js';
import { useAuth } from '../components/shared/Auth.jsx';
import { useToast } from '../components/shared/ToastProvider.jsx';
import ModalDialog from '../components/shared/ModalDialog.jsx';
import PlatformClientHeader from './PlatformClientHeader.jsx';
import { Building2, Sparkles, Trash2 } from 'lucide-react';
import LicenseConfigPanel from '../components/platform/LicenseConfigPanel.jsx';
import RecentActivityPanel from '../components/platform/RecentActivityPanel.jsx';
import {
  CLIENT_SERVICE_OTHER,
  CLIENT_SERVICE_PULSE,
  CLIENT_STATUS_PARENT_OPTIONS,
  clientStatusParent,
  clientStatusSubOptions,
  composeClientStatus,
  normalizeServices,
  normalizeClientStatus,
} from './platformClientUtils.js';

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

function readGroupLevels(settings) {
  const parsed = readClientSettings(settings);
  if (!parsed) return '';
  const asNumber = Number.parseInt(String(parsed.groupLevels ?? ''), 10);
  if (!Number.isInteger(asNumber) || asNumber < 1 || asNumber > 5) return '';
  return String(asNumber);
}

function readGroupLevelLabels(settings) {
  const parsed = readClientSettings(settings);
  if (!parsed || !Array.isArray(parsed.groupLevelLabels)) return [];
  return parsed.groupLevelLabels
    .slice(0, 5)
    .map((label) => String(label ?? ''));
}

export default function PlatformClientAccount() {
  const { org, orgId, refreshOrg, licenseConfig, clientLogoUrl, bumpClientLogo } =
    useOutletContext();
  const { user } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const isPlatformAdmin =
    user?.organizationKind === 'platform' && user?.role === 'admin';
  const isLicenseeOrg = org.kind === 'licensee';
  const logoInputRef = useRef(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const initialStatus = normalizeClientStatus(org.client_status);
  const initialStatusParent = clientStatusParent(initialStatus);
  const [editName, setEditName] = useState(org.name);
  const [clientStatusParentId, setClientStatusParentId] = useState(initialStatusParent);
  const [clientStatusSubId, setClientStatusSubId] = useState(() =>
    composeClientStatus(initialStatusParent, initialStatus)
  );
  const [address, setAddress] = useState(() => readCompanyAddress(org.settings));
  const [serviceCatalog, setServiceCatalog] = useState([]);
  const [selectedServices, setSelectedServices] = useState(() => normalizeServices(org.settings));
  const [groupLevels, setGroupLevels] = useState(() => readGroupLevels(org.settings));
  const [groupLevelLabels, setGroupLevelLabels] = useState(() => readGroupLevelLabels(org.settings));
  const [otherServiceDisplayValue, setOtherServiceDisplayValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const clientStatusSubStatusOptions = clientStatusSubOptions(clientStatusParentId);
  const showClientSubStatus = clientStatusSubStatusOptions.length > 1;

  useEffect(() => {
    const normalizedStatus = normalizeClientStatus(org.client_status);
    const nextParentId = clientStatusParent(normalizedStatus);
    setEditName(org.name);
    setClientStatusParentId(nextParentId);
    setClientStatusSubId(composeClientStatus(nextParentId, normalizedStatus));
    setAddress(readCompanyAddress(org.settings));
    setSelectedServices(normalizeServices(org.settings));
    setGroupLevels(readGroupLevels(org.settings));
    setGroupLevelLabels(readGroupLevelLabels(org.settings));
    setOtherServiceDisplayValue('');
  }, [org.name, org.client_status, org.settings]);

  useEffect(() => {
    const count = Number.parseInt(groupLevels, 10);
    if (!Number.isInteger(count) || count < 1 || count > 5) {
      setGroupLevelLabels([]);
      return;
    }
    setGroupLevelLabels((current) => {
      const next = current.slice(0, count);
      while (next.length < count) next.push('');
      return next;
    });
  }, [groupLevels]);

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
    setBusy(true);
    setError('');
    try {
      await api.patch(`/api/platform/organizations/${orgId}`, { name: editName.trim() });
      await refreshOrg();
      showToast('Company name saved.', { variant: 'success' });
    } catch (err) {
      setError(err.response?.data?.error || 'Could not update company.');
    } finally {
      setBusy(false);
    }
  }

  async function saveAddress(e) {
    e.preventDefault();
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
    const pulseEnabled = selectedServices.includes(CLIENT_SERVICE_PULSE);
    const parsedGroupLevels = pulseEnabled ? Number.parseInt(groupLevels, 10) : null;
    if (pulseEnabled && !Number.isInteger(parsedGroupLevels)) {
      setError('Select how many group levels this client has.');
      return;
    }
    const normalizedGroupLevelLabels = pulseEnabled
      ? groupLevelLabels
          .slice(0, parsedGroupLevels)
          .map((label) => String(label || '').trim())
      : [];
    if (pulseEnabled && normalizedGroupLevelLabels.some((label) => !label)) {
      setError('Provide a name for each group level.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api.patch(`/api/platform/organizations/${orgId}`, {
        settings: {
          services: selectedServices,
          groupLevels: pulseEnabled ? parsedGroupLevels : null,
          groupLevelLabels: pulseEnabled ? normalizedGroupLevelLabels : null,
        },
      });
      await refreshOrg();
      showToast('Services saved.', { variant: 'success' });
    } catch (err) {
      setError(err.response?.data?.error || 'Could not save services.');
    } finally {
      setBusy(false);
    }
  }

  async function saveClientStatus(e) {
    e.preventDefault();
    const nextStatus = composeClientStatus(clientStatusParentId, clientStatusSubId);
    setBusy(true);
    setError('');
    try {
      await api.patch(`/api/platform/organizations/${orgId}`, {
        clientStatus: nextStatus,
      });
      await refreshOrg();
      showToast('Client status saved.', { variant: 'success' });
    } catch (err) {
      setError(err.response?.data?.error || 'Could not save client status.');
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
    setBusy(true);
    setError('');
    try {
      const fd = new FormData();
      fd.append('logo', file);
      await api.post(`/api/platform/organizations/${orgId}/logo`, fd);
      await refreshOrg();
      bumpClientLogo();
      showToast('Company logo updated.', { variant: 'success' });
    } catch (err) {
      setError(err.response?.data?.error || 'Could not upload logo.');
    } finally {
      setBusy(false);
    }
  }

  async function removeCompanyLogo() {
    setBusy(true);
    setError('');
    try {
      await api.delete(`/api/platform/organizations/${orgId}/logo`);
      await refreshOrg();
      bumpClientLogo();
      showToast('Company logo removed.', { variant: 'success' });
    } catch (err) {
      setError(err.response?.data?.error || 'Could not remove logo.');
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

  async function downloadUserImportTemplate() {
    const pulseEnabled = selectedServices.includes(CLIENT_SERVICE_PULSE);
    const parsedGroupLevels = pulseEnabled ? Number.parseInt(groupLevels, 10) : null;
    if (!pulseEnabled || !Number.isInteger(parsedGroupLevels)) {
      setError('Select how many group levels this client has before downloading the template.');
      return;
    }
    const normalizedGroupLevelLabels = groupLevelLabels
      .slice(0, parsedGroupLevels)
      .map((label) => String(label || '').trim());
    if (normalizedGroupLevelLabels.some((label) => !label)) {
      setError('Provide a name for each group level before downloading the template.');
      return;
    }
    setError('');
    try {
      const response = await api.post(
        `/api/platform/organizations/${orgId}/user-import-template`,
        {
          groupLevels: parsedGroupLevels,
          groupLevelLabels: normalizedGroupLevelLabels,
        },
        { responseType: 'blob' }
      );
      const fallbackName = `client-${orgId}-user-import-template.csv`;
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
      setError(err.response?.data?.error || 'Could not download template.');
    }
  }

  return (
    <>
      <PlatformClientHeader orgName={org.name} logoSrc={clientLogoUrl} />
      {error && <p className="error" style={{ marginBottom: '1rem' }}>{error}</p>}
      {isLicenseeOrg && isPlatformAdmin && (
        <>
          <LicenseConfigPanel
            orgId={orgId}
            licenseConfig={licenseConfig}
            onSaved={refreshOrg}
          />
          <div className="card" style={{ marginBottom: '1.5rem' }}>
            <h2 className="platform-client-dashboard__h2" style={{ marginTop: 0 }}>Support tools</h2>
            <p className="muted" style={{ margin: '0 0 0.75rem', fontSize: '0.85rem' }}>
              Read-only impersonation lets you view this licensee's CRM exactly as their admin sees it.
              Writes are disabled. Sessions last 30 minutes and are audit-logged.
            </p>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={async () => {
                try {
                  const apiMod = await import('../services/api.js');
                  const { data } = await apiMod.default.post(
                    `/api/platform/organizations/${orgId}/support-impersonate`
                  );
                  if (data?.token) {
                    // Stash the original admin token so we can drop back
                    // out of the impersonation session without logging
                    // out and back in.
                    const previous = sessionStorage.getItem('pulse_token');
                    if (previous) sessionStorage.setItem('pulse_token__pre_impersonate', previous);
                    apiMod.setAuthToken(data.token);
                    sessionStorage.setItem('pulse_support_impersonation', '1');
                    window.location.assign('/platform');
                  }
                } catch (err) {
                  alert(err?.response?.data?.error || 'Could not start support session.');
                }
              }}
            >
              Start read-only support session
            </button>
          </div>
        </>
      )}
      <RecentActivityPanel orgId={orgId} />
      <div className="platform-client-dashboard-grid">
        <div className="card platform-client-dashboard__card">
          <h1 className="platform-client-dashboard__h2" style={{ marginTop: 0 }}>
            Account
          </h1>
          <p className="muted" style={{ marginTop: '-0.25rem', marginBottom: '1.25rem' }}>
            Company profile for this client workspace. Admins see the logo in their account, too.
          </p>

          <h2 className="platform-client-dashboard__h2">Company</h2>
          <form onSubmit={saveOrgName}>
            <div className="field">
              <label htmlFor="acct-ename">Company name</label>
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
            <div className="field">
              <label htmlFor="acct-client-status-parent">Client status</label>
              <select
                id="acct-client-status-parent"
                value={clientStatusParentId}
                onChange={(e) => {
                  const nextParentId = e.target.value;
                  const nextOptions = clientStatusSubOptions(nextParentId);
                  setClientStatusParentId(nextParentId);
                  setClientStatusSubId(nextOptions[0]?.id || '');
                }}
                disabled={busy}
              >
                {CLIENT_STATUS_PARENT_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            {showClientSubStatus ? (
              <div className="field">
                <label htmlFor="acct-client-status-sub">Sub status</label>
                <select
                  id="acct-client-status-sub"
                  value={composeClientStatus(clientStatusParentId, clientStatusSubId)}
                  onChange={(e) => setClientStatusSubId(normalizeClientStatus(e.target.value))}
                  disabled={busy}
                >
                  {clientStatusSubStatusOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            <button type="submit" className="btn btn-ghost" disabled={busy}>
              Save status
            </button>
          </form>

          <form onSubmit={saveServices} style={{ marginTop: '1.25rem', paddingTop: '1.25rem', borderTop: '1px solid var(--border)' }}>
            <h2 className="platform-client-dashboard__h2">Services</h2>
            <p className="muted" style={{ fontSize: '0.9rem', marginTop: 0 }}>
              Select the services enabled for this client.
            </p>
            <div style={{ display: 'grid', gap: '0.45rem' }}>
              {serviceCatalog.length === 0 ? (
                <p className="muted" style={{ margin: 0 }}>
                  No services have been defined in platform settings yet.
                </p>
              ) : (
                serviceCatalog.map((service) => (
                  <label key={service.id} style={{ display: 'flex', alignItems: 'center', gap: '0.55rem' }}>
                    <input
                      type="checkbox"
                      checked={selectedServices.includes(service.id)}
                      onChange={() => toggleService(service.id)}
                      disabled={busy}
                    />
                    <span>{service.name}</span>
                  </label>
                ))
              )}
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
            {selectedServices.includes(CLIENT_SERVICE_PULSE) ? (
              <div className="field" style={{ marginTop: '0.9rem' }}>
                <label htmlFor="acct-group-levels">How many group levels does this client have?</label>
                <select
                  id="acct-group-levels"
                  value={groupLevels}
                  onChange={(e) => setGroupLevels(e.target.value)}
                  disabled={busy}
                  required
                >
                  <option value="">Select group levels</option>
                  <option value="1">1</option>
                  <option value="2">2</option>
                  <option value="3">3</option>
                  <option value="4">4</option>
                  <option value="5">5</option>
                </select>
              </div>
            ) : null}
            {selectedServices.includes(CLIENT_SERVICE_PULSE) && Number.parseInt(groupLevels, 10) > 0 ? (
              <div style={{ marginTop: '0.9rem', display: 'grid', gap: '0.55rem' }}>
                {Array.from({ length: Number.parseInt(groupLevels, 10) }, (_, index) => (
                  <div className="field" key={`group-level-label-${index + 1}`} style={{ margin: 0 }}>
                    <label htmlFor={`acct-group-level-label-${index + 1}`}>
                      Group level {index + 1} label
                    </label>
                    <input
                      id={`acct-group-level-label-${index + 1}`}
                      value={groupLevelLabels[index] ?? ''}
                      onChange={(e) =>
                        setGroupLevelLabels((current) => {
                          const next = [...current];
                          next[index] = e.target.value;
                          return next;
                        })
                      }
                      placeholder={`e.g. Level ${index + 1}`}
                      disabled={busy}
                      required
                    />
                  </div>
                ))}
              </div>
            ) : null}
            <button type="submit" className="btn btn-ghost" disabled={busy} style={{ marginTop: '0.9rem' }}>
              Save services
            </button>
            {selectedServices.includes(CLIENT_SERVICE_PULSE) ? (
              <button
                type="button"
                className="btn btn-ghost"
                disabled={busy}
                style={{ marginTop: '0.65rem', marginLeft: '0.5rem' }}
                onClick={downloadUserImportTemplate}
              >
                Download CSV template
              </button>
            ) : null}
          </form>

        </div>

        <div className="card platform-client-dashboard__card">
          <h2 className="platform-client-dashboard__h2" style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Building2 size={20} strokeWidth={1.75} aria-hidden />
            Company logo
          </h2>
          <p className="muted" style={{ fontSize: '0.9rem', marginTop: 0 }}>
            Shown in the client workspace header and in client accounts for their admins.
          </p>
          <div className="company-logo-preview-wrap">
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
              <button type="button" className="btn btn-ghost" disabled={busy} onClick={removeCompanyLogo}>
                Remove logo
              </button>
            ) : null}
          </div>
          <p className="muted" style={{ fontSize: '0.85rem', marginTop: '0.75rem', marginBottom: 0 }}>
            JPG, PNG, GIF, or WebP, up to 2&nbsp;MB.
          </p>

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
        </div>

      </div>

      <div
        className="card"
        style={{
          marginTop: '2rem',
          borderColor: 'var(--danger, #dc3545)',
          borderWidth: '1px',
          borderStyle: 'solid',
        }}
      >
        <h2 className="platform-client-dashboard__h2" style={{ marginTop: 0, color: 'var(--danger, #dc3545)' }}>
          Danger zone
        </h2>
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
