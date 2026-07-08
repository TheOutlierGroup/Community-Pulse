import { useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { Trash2 } from 'lucide-react';
import api from '../services/api.js';
import { useToast } from '../components/shared/ToastProvider.jsx';
import { BUSINESS_UNITS, LEAD_STATUSES } from '../config/crmConstants.js';

export default function PlatformProspectConfigurations() {
  const { org, orgId, refreshOrg } = useOutletContext();
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [editForm, setEditForm] = useState({
    organisation_name: org.organisation_name,
    industry: org.industry || '',
    website: org.website || '',
    phone: org.phone || '',
    business_unit: org.business_unit,
    lead_status: org.lead_status,
    lead_source: org.lead_source || '',
    expected_close_date: org.expected_close_date?.slice(0, 10) || '',
  });
  const [saveBusy, setSaveBusy] = useState(false);

  async function saveOrg(e) {
    e.preventDefault();
    setSaveBusy(true);
    try {
      await api.patch(`/api/platform/crm/organisations/${orgId}`, editForm);
      await refreshOrg();
      showToast('Organisation updated.', { variant: 'success' });
    } catch (err) {
      showToast(err.response?.data?.error || 'Failed to update.', { variant: 'error' });
    } finally { setSaveBusy(false); }
  }

  async function deleteOrg() {
    if (!confirm(`Permanently delete "${org.organisation_name}"? This will also delete all contacts, notes, and tasks.`)) return;
    try {
      await api.delete(`/api/platform/crm/organisations/${orgId}`);
      showToast('Organisation deleted.', { variant: 'success' });
      navigate('/platform/crm/organisations');
    } catch { showToast('Failed to delete organisation.', { variant: 'error' }); }
  }

  return (
    <div>
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
              <label>Website</label>
              <input type="url" value={editForm.website} onChange={(e) => setEditForm((p) => ({ ...p, website: e.target.value }))} />
            </div>
            <div className="field">
              <label>Phone</label>
              <input type="tel" value={editForm.phone} onChange={(e) => setEditForm((p) => ({ ...p, phone: e.target.value }))} />
            </div>
            <div className="field">
              <label>Lead source</label>
              <input value={editForm.lead_source} onChange={(e) => setEditForm((p) => ({ ...p, lead_source: e.target.value }))} />
            </div>
            <div className="field">
              <label>Expected close date</label>
              <input type="date" value={editForm.expected_close_date} onChange={(e) => setEditForm((p) => ({ ...p, expected_close_date: e.target.value }))} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
            <button className="btn btn-primary" type="submit" disabled={saveBusy}>Save changes</button>
          </div>
        </form>
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
    </div>
  );
}
