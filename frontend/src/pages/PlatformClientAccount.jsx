import { useEffect, useRef, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import api from '../services/api.js';
import { useToast } from '../components/shared/ToastProvider.jsx';
import PlatformClientHeader from './PlatformClientHeader.jsx';
import { Building2, Sparkles } from 'lucide-react';
import {
  CLIENT_SERVICE_OPTIONS,
  CLIENT_STATUS_OPTIONS,
  normalizeClientStatus,
  normalizeServices,
  normalizeSettings,
} from './platformClientUtils.js';

function readCompanyAddress(settings) {
  if (settings == null) return '';
  let s = settings;
  if (typeof s === 'string') {
    try {
      s = JSON.parse(s);
    } catch {
      return '';
    }
  }
  if (typeof s !== 'object') return '';
  const v = s.companyAddress;
  return v == null ? '' : String(v);
}

export default function PlatformClientAccount() {
  const { org, orgId, refreshOrg, clientLogoUrl, bumpClientLogo } = useOutletContext();
  const { showToast } = useToast();
  const logoInputRef = useRef(null);
  const [editName, setEditName] = useState(org.name);
  const [clientStatus, setClientStatus] = useState(() => normalizeClientStatus(org.client_status));
  const [address, setAddress] = useState(() => readCompanyAddress(org.settings));
  const [services, setServices] = useState(() => normalizeServices(org.settings));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setEditName(org.name);
    setClientStatus(normalizeClientStatus(org.client_status));
    setAddress(readCompanyAddress(org.settings));
    setServices(normalizeServices(org.settings));
  }, [org.name, org.client_status, org.settings]);

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

  async function saveClientStatus(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.patch(`/api/platform/organizations/${orgId}`, {
        clientStatus: clientStatus,
      });
      await refreshOrg();
      showToast('Client status saved.', { variant: 'success' });
    } catch (err) {
      setError(err.response?.data?.error || 'Could not save client status.');
    } finally {
      setBusy(false);
    }
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

  async function saveServices(nextServices) {
    setBusy(true);
    setError('');
    try {
      const nextSettings = { ...normalizeSettings(org.settings), services: nextServices };
      if ('pulseEnabled' in nextSettings) delete nextSettings.pulseEnabled;
      await api.patch(`/api/platform/organizations/${orgId}`, { settings: nextSettings });
      await refreshOrg();
      showToast('Services saved.', { variant: 'success' });
    } catch (err) {
      setError(err.response?.data?.error || 'Could not save services.');
      setServices(normalizeServices(org.settings));
    } finally {
      setBusy(false);
    }
  }

  function onToggleService(serviceId, checked) {
    const next = checked
      ? Array.from(new Set([...services, serviceId]))
      : services.filter((id) => id !== serviceId);
    setServices(next);
    saveServices(next);
  }

  return (
    <>
      <PlatformClientHeader orgName={org.name} logoSrc={clientLogoUrl} />
      {error && <p className="error" style={{ marginBottom: '1rem' }}>{error}</p>}
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
              <label htmlFor="acct-client-status">Client status</label>
              <select
                id="acct-client-status"
                value={clientStatus}
                onChange={(e) => setClientStatus(normalizeClientStatus(e.target.value))}
                disabled={busy}
              >
                {CLIENT_STATUS_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <button type="submit" className="btn btn-ghost" disabled={busy}>
              Save status
            </button>
          </form>

          <div style={{ marginTop: '1.25rem', paddingTop: '1.25rem', borderTop: '1px solid var(--border)' }}>
            <h2 className="platform-client-dashboard__h2">Services</h2>
            <p className="muted" style={{ fontSize: '0.9rem', marginTop: 0 }}>
              Tick the services this client is paying for. Only Pulse enables app features.
            </p>
            {CLIENT_SERVICE_OPTIONS.map((service) => (
              <label
                key={service.id}
                style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.35rem 0' }}
              >
                <input
                  type="checkbox"
                  checked={services.includes(service.id)}
                  disabled={busy}
                  onChange={(e) => onToggleService(service.id, e.target.checked)}
                />
                <span>{service.label}</span>
              </label>
            ))}
          </div>

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
    </>
  );
}
