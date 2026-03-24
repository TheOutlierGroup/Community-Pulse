import { useEffect, useRef, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import api from '../services/api.js';
import { useToast } from '../components/shared/ToastProvider.jsx';
import PlatformClientHeader from './PlatformClientHeader.jsx';
import { Building2 } from 'lucide-react';

export default function PlatformClientOverview() {
  const { org, orgId, refreshOrg, clientLogoUrl, bumpClientLogo } = useOutletContext();
  const { showToast } = useToast();
  const logoInputRef = useRef(null);
  const [editName, setEditName] = useState(org.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setEditName(org.name);
  }, [org.name]);

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

  return (
    <>
      <PlatformClientHeader orgName={org.name} logoSrc={clientLogoUrl} />
      {error && <p className="error" style={{ marginBottom: '1rem' }}>{error}</p>}
      <div className="platform-client-dashboard-grid">
        <div className="card platform-client-dashboard__card platform-client-dashboard__card--wide">
          <h2 className="platform-client-dashboard__h2">Company</h2>
          <form onSubmit={saveOrgName}>
            <div className="field">
              <label htmlFor="dash-ename">Company name</label>
              <input
                id="dash-ename"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                required
              />
            </div>
            <button type="submit" className="btn btn-ghost" disabled={busy}>
              Save name
            </button>
          </form>
          <div style={{ marginTop: '1.25rem', paddingTop: '1.25rem', borderTop: '1px solid var(--border)' }}>
            <h3 className="platform-client-dashboard__h2" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Building2 size={20} strokeWidth={1.75} aria-hidden />
              Company logo
            </h3>
            <p className="muted" style={{ fontSize: '0.9rem', marginTop: 0 }}>
              Shown in the client workspace header and in Settings for their admins.
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
                className="btn btn-primary"
                disabled={busy}
                onClick={() => logoInputRef.current?.click()}
              >
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
          </div>
          <p className="muted" style={{ marginTop: '1rem', fontSize: '0.85rem', marginBottom: 0 }}>
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
    </>
  );
}
