import { useEffect, useRef, useState } from 'react';
import { ChevronDown, X } from 'lucide-react';
import api from '../../services/api.js';
import { CLIENT_SERVICE_LICENSEE, CLIENT_SERVICE_PULSE } from '../../utils/clientServices.js';

const BLANK_FIELDS = {
  name: '',
  address: '',
  adminEmail: '',
  adminFirstName: '',
  adminLastName: '',
  serviceIds: [],
};

function serviceSummary(selectedIds, catalog) {
  if (selectedIds.length === 0) return 'Select services';
  const names = selectedIds
    .map((id) => catalog.find((s) => s.id === id)?.name)
    .filter(Boolean);
  if (names.length <= 2) return names.join(', ');
  return `${names.length} services selected`;
}

export default function NewClientModal({
  open,
  onClose,
  onCreated,
  isLicensee = false,
  canCreateLicensees = false,
  title = 'New Client',
  submitLabel = 'Create client',
  helperText = null,
  initialValues = null,
}) {
  const [serviceCatalog, setServiceCatalog] = useState([]);
  const [fields, setFields] = useState(BLANK_FIELDS);
  const [sendWelcomeEmail, setSendWelcomeEmail] = useState(false);
  const [enableLogin, setEnableLogin] = useState(true);
  const [logo, setLogo] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [servicesOpen, setServicesOpen] = useState(false);
  const servicesRef = useRef(null);
  // null = not yet chosen. Only relevant when Rhythm Engine is selected and
  // this account can create Practitioners — decides whether the new org
  // becomes a Practitioner (licensee) shell or a standalone Enterprise
  // client with its own licence.
  const [rhythmEngineMode, setRhythmEngineMode] = useState(null);
  // Only relevant when rhythmEngineMode === 'enterprise' — which specific
  // Enterprise licence size to provision. Previously this was silently
  // hardcoded server-side to 'enterprise_mid' regardless of intent, so the
  // Licence panel could show a tier that didn't match what was actually
  // meant at creation time.
  const [enterpriseLicenceTier, setEnterpriseLicenceTier] = useState('enterprise_mid');

  useEffect(() => {
    if (!open) return;
    setFields({ ...BLANK_FIELDS, ...initialValues });
    setSendWelcomeEmail(false);
    setEnableLogin(true);
    setLogo(null);
    setError('');
    setServicesOpen(false);
    setRhythmEngineMode(null);
    setEnterpriseLicenceTier('enterprise_mid');
    (async () => {
      try {
        const { data } = await api.get('/api/platform/service-catalog');
        setServiceCatalog((data.services || []).filter((s) => s.id !== CLIENT_SERVICE_LICENSEE));
      } catch {
        setServiceCatalog([]);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!servicesOpen) return undefined;
    function onDocMouseDown(e) {
      if (servicesRef.current && !servicesRef.current.contains(e.target)) setServicesOpen(false);
    }
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [servicesOpen]);

  if (!open) return null;

  function toggleService(id) {
    setFields((p) => ({
      ...p,
      serviceIds: p.serviceIds.includes(id)
        ? p.serviceIds.filter((s) => s !== id)
        : [...p.serviceIds, id],
    }));
    if (id === CLIENT_SERVICE_PULSE) setRhythmEngineMode(null);
  }

  const rhythmEngineSelected = fields.serviceIds.includes(CLIENT_SERVICE_PULSE);
  const needsRhythmEngineModeChoice = canCreateLicensees && rhythmEngineSelected;

  async function submit(e) {
    e.preventDefault();
    if (needsRhythmEngineModeChoice && !rhythmEngineMode) {
      setError('Choose whether this is a Practitioner or an Enterprise of Rhythm Engine.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const fd = new FormData();
      fd.append('name', fields.name.trim());
      if (fields.address.trim()) fd.append('companyAddress', fields.address.trim());
      if (fields.adminEmail.trim()) fd.append('adminEmail', fields.adminEmail.trim());
      if (fields.adminFirstName.trim()) fd.append('adminFirstName', fields.adminFirstName.trim());
      if (fields.adminLastName.trim()) fd.append('adminLastName', fields.adminLastName.trim());
      if (fields.adminEmail.trim() && !isLicensee) {
        fd.append('sendWelcomeEmail', sendWelcomeEmail ? 'true' : 'false');
        fd.append('enableLogin', enableLogin ? 'true' : 'false');
      }
      // Rhythm Engine no longer implies Rhythm Engine Licensee (Practitioner)
      // automatically — the admin explicitly chooses Practitioner or
      // Enterprise above. Practitioner status can only be granted at
      // creation time (it never changes after), so that choice has to
      // travel with this same request.
      const serviceIds = needsRhythmEngineModeChoice && rhythmEngineMode === 'practitioner'
        ? [...fields.serviceIds, CLIENT_SERVICE_LICENSEE]
        : fields.serviceIds;
      if (serviceIds.length) fd.append('clientServiceIds', JSON.stringify(serviceIds));
      if (needsRhythmEngineModeChoice && rhythmEngineMode === 'enterprise') {
        fd.append('enterpriseLicence', 'true');
        fd.append('enterpriseLicenceTier', enterpriseLicenceTier);
      }
      if (logo) fd.append('logo', logo);
      const { data } = await api.post('/api/platform/organizations', fd);
      await onCreated(data);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Could not create client.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <div
        className="modal-dialog modal-dialog--wide card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-client-modal-title"
      >
        <div className="modal-dialog__head">
          <h2 id="new-client-modal-title" style={{ margin: 0, fontSize: '1.15rem' }}>
            {title}
          </h2>
          <button type="button" className="btn btn-ghost modal-dialog__close" onClick={onClose} aria-label="Close">
            <X size={22} aria-hidden />
          </button>
        </div>
        {helperText ? (
          <p className="muted" style={{ fontSize: '0.85rem', marginTop: '0.5rem', marginBottom: 0 }}>
            {helperText}
          </p>
        ) : null}
        {error && <p className="error" style={{ marginBottom: '1rem' }}>{error}</p>}
        <form onSubmit={submit}>
          <div className="field">
            <label htmlFor="ncm-name">Client name</label>
            <input
              id="ncm-name"
              value={fields.name}
              onChange={(e) => setFields((p) => ({ ...p, name: e.target.value }))}
              required
              autoComplete="off"
            />
          </div>
          <div className="field">
            <label htmlFor="ncm-address">Address (optional)</label>
            <textarea
              id="ncm-address"
              value={fields.address}
              onChange={(e) => setFields((p) => ({ ...p, address: e.target.value }))}
              rows={3}
              className="platform-textarea"
              placeholder="Street, city, region, postcode, country"
              autoComplete="street-address"
            />
          </div>
          <div className="field">
            <label htmlFor="ncm-aemail">First admin email (optional)</label>
            <input
              id="ncm-aemail"
              type="email"
              value={fields.adminEmail}
              onChange={(e) => setFields((p) => ({ ...p, adminEmail: e.target.value }))}
              placeholder="admin@client.com"
              autoComplete="off"
            />
            <p className="muted" style={{ fontSize: '0.8rem', marginTop: '0.35rem' }}>
              If set, we create this user as a client admin (no invite link).
            </p>
          </div>
          <fieldset className="modal-dialog__fieldset">
            <legend>First admin name (optional)</legend>
            <div className="modal-dialog__name-row">
              <div className="field">
                <label htmlFor="ncm-afirst">First name</label>
                <input
                  id="ncm-afirst"
                  value={fields.adminFirstName}
                  onChange={(e) => setFields((p) => ({ ...p, adminFirstName: e.target.value }))}
                  autoComplete="given-name"
                />
              </div>
              <div className="field">
                <label htmlFor="ncm-alast">Last name</label>
                <input
                  id="ncm-alast"
                  value={fields.adminLastName}
                  onChange={(e) => setFields((p) => ({ ...p, adminLastName: e.target.value }))}
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
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.6rem', padding: '0.35rem 0' }}>
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
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.6rem', padding: '0.35rem 0' }}>
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
          {serviceCatalog.length > 0 && (
            <div className="field" ref={servicesRef} style={{ position: 'relative' }}>
              <label htmlFor="ncm-services-trigger">Services (optional — more can be enabled later in Configurations)</label>
              <button
                id="ncm-services-trigger"
                type="button"
                className="platform-select-trigger"
                disabled={busy}
                onClick={() => setServicesOpen((v) => !v)}
                aria-expanded={servicesOpen}
              >
                <span>{serviceSummary(fields.serviceIds, serviceCatalog)}</span>
                <ChevronDown size={16} strokeWidth={2} aria-hidden />
              </button>
              {servicesOpen && (
                <div className="platform-select-panel" role="listbox" aria-multiselectable="true">
                  {serviceCatalog.map((service) => (
                    <label key={service.id} className="platform-select-option">
                      <input
                        type="checkbox"
                        checked={fields.serviceIds.includes(service.id)}
                        disabled={busy}
                        onChange={() => toggleService(service.id)}
                      />
                      {service.name}
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}
          {needsRhythmEngineModeChoice ? (
            <div className="field" style={{ background: 'var(--surface2)', borderRadius: 10, padding: '0.85rem 1rem' }}>
              <p style={{ margin: '0 0 0.6rem', fontWeight: 600, fontSize: '0.9rem' }}>
                Is this a Practitioner or an Enterprise of Rhythm Engine?
              </p>
              <p className="muted" style={{ fontSize: '0.8rem', margin: '0 0 0.7rem' }}>
                A <strong>Practitioner</strong> resells or administers Rhythm Engine to its own downstream
                clients and holds the licence there. An <strong>Enterprise</strong> runs Rhythm Engine
                directly on itself, with its own contract and assessment quota.
              </p>
              <div style={{ display: 'flex', gap: '0.6rem' }}>
                <button
                  type="button"
                  className={`btn ${rhythmEngineMode === 'practitioner' ? 'btn-primary' : 'btn-ghost'}`}
                  disabled={busy}
                  onClick={() => setRhythmEngineMode('practitioner')}
                >
                  Practitioner
                </button>
                <button
                  type="button"
                  className={`btn ${rhythmEngineMode === 'enterprise' ? 'btn-primary' : 'btn-ghost'}`}
                  disabled={busy}
                  onClick={() => setRhythmEngineMode('enterprise')}
                >
                  Enterprise
                </button>
              </div>
              {rhythmEngineMode === 'enterprise' ? (
                <div className="field" style={{ marginTop: '0.75rem', marginBottom: 0 }}>
                  <label htmlFor="ncm-enterprise-tier">Enterprise licence size</label>
                  <select
                    id="ncm-enterprise-tier"
                    value={enterpriseLicenceTier}
                    onChange={(e) => setEnterpriseLicenceTier(e.target.value)}
                    disabled={busy}
                  >
                    <option value="enterprise_mid">Enterprise (Mid)</option>
                    <option value="enterprise_large">Enterprise (Large)</option>
                    <option value="enterprise_unlimited">Enterprise (Unlimited)</option>
                  </select>
                  <p className="muted" style={{ fontSize: '0.8rem', marginTop: '0.35rem' }}>
                    Sets the initial licence tier. Adjustable later in Configurations.
                  </p>
                </div>
              ) : null}
            </div>
          ) : null}
          <div className="field">
            <label htmlFor="ncm-logo">Client logo (optional)</label>
            <input
              id="ncm-logo"
              type="file"
              accept="image/jpeg,image/png,image/gif,image/webp"
              onChange={(e) => setLogo(e.target.files?.[0] || null)}
            />
            <p className="muted" style={{ fontSize: '0.8rem', marginTop: '0.35rem' }}>
              JPG, PNG, GIF, or WebP, up to 2&nbsp;MB.
            </p>
          </div>
          <div className="modal-dialog__actions">
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary modal-dialog__submit" disabled={busy}>
              {busy ? 'Creating…' : submitLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
