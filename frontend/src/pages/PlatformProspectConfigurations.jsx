import { useEffect, useRef, useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { Building2, Sparkles, TrendingUp, Trash2 } from 'lucide-react';
import api from '../services/api.js';
import { useAuth } from '../components/shared/Auth.jsx';
import { useToast } from '../components/shared/ToastProvider.jsx';
import AuthenticatedBlobImage from '../components/platform/AuthenticatedBlobImage.jsx';
import NewClientModal from '../components/platform/NewClientModal.jsx';
import { isLicenseeUser } from '../hooks/usePlatformAccess.js';
import { RELATIONSHIP_STATUS_OPTIONS, normalizeRelationshipStatus } from './platformClientUtils.js';
import { serviceIdForBusinessUnit } from '../utils/prospectPromotion.js';
import { BUSINESS_UNITS, LEAD_STATUSES, BUSINESS_UNIT_CUSTOM_FIELDS } from '../config/crmConstants.js';

function ownerLabel(u) {
  if (!u) return '';
  const name = [u.firstName, u.lastName].filter(Boolean).join(' ').trim();
  return name || u.email || '';
}

// datetime-local inputs want "YYYY-MM-DDTHH:mm" in local time, with no
// timezone suffix — slicing an ISO string to 16 chars gives UTC wall-clock
// digits, which is wrong once the user is outside UTC, so build it from
// the Date object's local getters instead.
function toDatetimeLocalValue(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function PlatformProspectConfigurations() {
  const { org, orgId, contacts, refreshOrg, bumpLogoRev } = useOutletContext();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { showToast } = useToast();
  const isLicensee = isLicenseeUser(user);
  const logoInputRef = useRef(null);
  const [logoBusy, setLogoBusy] = useState(false);
  const [logoRev, setLogoRev] = useState(0);
  const [promoteModalOpen, setPromoteModalOpen] = useState(false);
  const [owners, setOwners] = useState([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get(`/api/platform/crm/organisations/${orgId}/tasks/assignable-users`);
        if (!cancelled) setOwners(data.users || []);
      } catch {
        if (!cancelled) setOwners([]);
      }
    })();
    return () => { cancelled = true; };
  }, [orgId]);

  const [editForm, setEditForm] = useState({
    organisation_name: org.organisation_name,
    industry: org.industry || '',
    website: org.website || '',
    phone: org.phone || '',
    business_unit: org.business_unit,
    lead_status: org.lead_status,
    relationship_status: normalizeRelationshipStatus(org.relationship_status),
    lead_source: org.lead_source || '',
    expected_close_date: org.expected_close_date?.slice(0, 10) || '',
    do_not_contact: Boolean(org.do_not_contact),
    owner_user_id: org.owner_user_id || '',
    last_contact_at: toDatetimeLocalValue(org.last_contact_at),
    custom_fields: org.custom_fields || {},
  });
  const [saveBusy, setSaveBusy] = useState(false);

  function setCustomField(key, value) {
    setEditForm((p) => ({ ...p, custom_fields: { ...p.custom_fields, [key]: value } }));
  }

  const skateFields = BUSINESS_UNIT_CUSTOM_FIELDS[editForm.business_unit] || [];

  async function saveOrg(e) {
    e.preventDefault();
    setSaveBusy(true);
    try {
      const payload = {
        ...editForm,
        last_contact_at: editForm.last_contact_at ? new Date(editForm.last_contact_at).toISOString() : '',
      };
      await api.patch(`/api/platform/crm/organisations/${orgId}`, payload);
      await refreshOrg();
      showToast('Organisation updated.', { variant: 'success' });
    } catch (err) {
      showToast(err.response?.data?.error || 'Failed to update.', { variant: 'error' });
    } finally { setSaveBusy(false); }
  }

  async function handlePromoted(data) {
    const clientOrg = data.organization;
    try {
      await api.post(`/api/platform/crm/organisations/${orgId}/promote`, { clientOrgId: clientOrg.id });
      showToast(`${org.organisation_name} was promoted to Client.`, { variant: 'success' });
      navigate(`/platform/clients/${clientOrg.id}`);
    } catch (err) {
      showToast(err.response?.data?.error || 'Client was created, but promotion linking failed.', { variant: 'error' });
      setPromoteModalOpen(false);
      await refreshOrg();
    }
  }

  async function onLogoFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setLogoBusy(true);
    try {
      const fd = new FormData();
      fd.append('logo', file);
      await api.post(`/api/platform/crm/organisations/${orgId}/logo`, fd);
      await refreshOrg();
      setLogoRev((v) => v + 1);
      bumpLogoRev();
      showToast('Company logo updated.', { variant: 'success' });
    } catch (err) {
      showToast(err.response?.data?.error || 'Could not upload logo.', { variant: 'error' });
    } finally {
      setLogoBusy(false);
    }
  }

  async function removeLogo() {
    setLogoBusy(true);
    try {
      await api.delete(`/api/platform/crm/organisations/${orgId}/logo`);
      await refreshOrg();
      setLogoRev((v) => v + 1);
      bumpLogoRev();
      showToast('Company logo removed.', { variant: 'success' });
    } catch (err) {
      showToast(err.response?.data?.error || 'Could not remove logo.', { variant: 'error' });
    } finally {
      setLogoBusy(false);
    }
  }

  async function deleteOrg() {
    if (!confirm(`Permanently delete "${org.organisation_name}"? This will also delete all contacts, notes, and tasks.`)) return;
    try {
      await api.delete(`/api/platform/crm/organisations/${orgId}`);
      showToast('Organisation deleted.', { variant: 'success' });
      navigate('/platform/crm/organisations');
    } catch { showToast('Failed to delete organisation.', { variant: 'error' }); }
  }

  const firstContact = contacts?.[0] || null;
  const promoteInitialValues = {
    name: org.organisation_name,
    adminEmail: firstContact?.contact_email || '',
    adminFirstName: firstContact?.contact_firstname || '',
    adminLastName: firstContact?.contact_lastname || '',
    serviceIds: [serviceIdForBusinessUnit(org.business_unit)].filter(Boolean),
  };

  return (
    <div>
      {!org.promoted_to_org_id && (
        <div
          className="card"
          style={{
            padding: '1.25rem',
            marginBottom: '1.5rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '1rem',
            flexWrap: 'wrap',
          }}
        >
          <div>
            <div style={{ fontWeight: 700, marginBottom: '0.25rem' }}>Promote to Client</div>
            <p className="muted" style={{ fontSize: '0.9rem', margin: 0 }}>
              Won this prospect? Create the matching client, prefilled from this prospect.
            </p>
          </div>
          <button type="button" className="btn btn-primary" onClick={() => setPromoteModalOpen(true)}>
            <TrendingUp size={16} strokeWidth={2} aria-hidden style={{ marginRight: '0.35rem' }} />
            Promote to Client
          </button>
        </div>
      )}

      <div className="card" style={{ padding: '1.25rem', marginBottom: '1.5rem' }}>
        <div style={{ fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--muted)', marginBottom: '1rem' }}>
          Prospect details
        </div>
        <form onSubmit={saveOrg}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <div className="field">
              <label>Organisation name *</label>
              <input value={editForm.organisation_name} onChange={(e) => setEditForm((p) => ({ ...p, organisation_name: e.target.value }))} required />
            </div>
            <div className="field">
              <label>Industry</label>
              <input value={editForm.industry} onChange={(e) => setEditForm((p) => ({ ...p, industry: e.target.value }))} />
            </div>
            <div className="field">
              <label>Business unit</label>
              <select value={editForm.business_unit} onChange={(e) => setEditForm((p) => ({ ...p, business_unit: e.target.value }))}>
                {BUSINESS_UNITS.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Lead status</label>
              <select value={editForm.lead_status} onChange={(e) => setEditForm((p) => ({ ...p, lead_status: e.target.value }))}>
                {LEAD_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Relationship Status</label>
              <select value={editForm.relationship_status} onChange={(e) => setEditForm((p) => ({ ...p, relationship_status: e.target.value }))}>
                {RELATIONSHIP_STATUS_OPTIONS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Website</label>
              <input type="url" value={editForm.website} onChange={(e) => setEditForm((p) => ({ ...p, website: e.target.value }))} />
            </div>
            <div className="field">
              <label>Phone</label>
              <input type="tel" value={editForm.phone} onChange={(e) => setEditForm((p) => ({ ...p, phone: e.target.value }))} />
            </div>
            <div className="field">
              <label>Lead Origin</label>
              <input value={editForm.lead_source} onChange={(e) => setEditForm((p) => ({ ...p, lead_source: e.target.value }))} />
            </div>
            <div className="field">
              <label>Expected close date</label>
              <input type="date" value={editForm.expected_close_date} onChange={(e) => setEditForm((p) => ({ ...p, expected_close_date: e.target.value }))} />
            </div>
            <div className="field">
              <label>Owner</label>
              <select value={editForm.owner_user_id} onChange={(e) => setEditForm((p) => ({ ...p, owner_user_id: e.target.value }))}>
                <option value="">Unassigned</option>
                {owners.map((o) => <option key={o.id} value={o.id}>{ownerLabel(o)}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Last contact</label>
              <input
                type="datetime-local"
                value={editForm.last_contact_at}
                onChange={(e) => setEditForm((p) => ({ ...p, last_contact_at: e.target.value }))}
              />
            </div>
          </div>

          {skateFields.length > 0 && (
            <div style={{ marginTop: '1.25rem' }}>
              <div style={{ fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--muted)', marginBottom: '0.75rem' }}>
                Outlier Skate details
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                {skateFields.map((field) => (
                  <div className="field" key={field.key}>
                    <label>{field.label}</label>
                    {field.type === 'select' ? (
                      <select
                        value={editForm.custom_fields[field.key] || ''}
                        onChange={(e) => setCustomField(field.key, e.target.value)}
                      >
                        <option value="">—</option>
                        {field.options.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                      </select>
                    ) : (
                      <input
                        type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
                        value={editForm.custom_fields[field.key] ?? ''}
                        onChange={(e) => setCustomField(field.key, e.target.value)}
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.6rem', marginTop: '0.75rem' }}>
            <input
              type="checkbox"
              checked={editForm.do_not_contact}
              onChange={(e) => setEditForm((p) => ({ ...p, do_not_contact: e.target.checked }))}
            />
            <span>
              Do not contact
              <span className="muted" style={{ display: 'block', fontSize: '0.8rem', marginTop: '0.2rem' }}>
                Flags this prospect as one we should not reach out to.
              </span>
            </span>
          </label>
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
            <button className="btn btn-primary" type="submit" disabled={saveBusy}>Save changes</button>
          </div>
        </form>
      </div>

      <div className="card platform-client-dashboard__card" style={{ marginBottom: '1.5rem' }}>
        <h2 className="platform-client-dashboard__h2" style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Building2 size={20} strokeWidth={1.75} aria-hidden />
          Company logo
        </h2>
        <p className="muted" style={{ fontSize: '0.9rem', marginTop: 0 }}>
          Shown next to the prospect name here and in the prospects list.
        </p>
        <div className="company-logo-preview-wrap">
          {org.logo_filename ? (
            <AuthenticatedBlobImage
              path={`/api/platform/crm/organisations/${orgId}/logo?v=${logoRev}`}
              alt=""
              className="company-logo-preview"
            />
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
          onChange={onLogoFile}
          disabled={logoBusy}
        />
        <div className="btn-row" style={{ marginTop: 0 }}>
          <button
            type="button"
            className="btn btn-primary platform-inline-primary"
            disabled={logoBusy}
            onClick={() => logoInputRef.current?.click()}
          >
            <Sparkles size={18} strokeWidth={1.75} aria-hidden style={{ marginRight: '0.35rem' }} />
            {logoBusy ? 'Working…' : org.logo_filename ? 'Change logo' : 'Upload logo'}
          </button>
          {org.logo_filename ? (
            <button type="button" className="btn btn-ghost" disabled={logoBusy} onClick={removeLogo}>
              Remove logo
            </button>
          ) : null}
        </div>
        <p className="muted" style={{ fontSize: '0.85rem', marginTop: '0.75rem', marginBottom: 0 }}>
          JPG, PNG, GIF, or WebP, up to 2&nbsp;MB.
        </p>
      </div>

      <div
        className="card"
        style={{
          borderColor: 'var(--danger, #dc3545)',
          borderWidth: '1px',
          borderStyle: 'solid',
        }}
      >
        <p className="muted" style={{ fontSize: '0.9rem', marginTop: 0 }}>
          Permanently delete this prospect and all associated contacts, notes, and tasks. This action cannot be undone.
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
          onClick={deleteOrg}
        >
          <Trash2 size={16} strokeWidth={1.75} aria-hidden />
          Delete prospect
        </button>
      </div>

      <NewClientModal
        open={promoteModalOpen}
        onClose={() => setPromoteModalOpen(false)}
        onCreated={handlePromoted}
        isLicensee={isLicensee}
        canCreateLicensees={!isLicensee}
        title="Promote to Client"
        submitLabel="Create client"
        helperText={`Promoting "${org.organisation_name}" from Prospects. Review the prefilled details before creating the client — lead status, relationship status, website, phone, lead origin, and expected close date will be preserved in the new client's Recent Activity log.`}
        initialValues={promoteInitialValues}
      />
    </div>
  );
}
