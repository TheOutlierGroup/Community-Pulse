import { useEffect, useState } from 'react';
import { Plus, X, Users2, User, AlertTriangle } from 'lucide-react';
import api from '../../services/api.js';
import { useToast } from '../shared/ToastProvider.jsx';
import {
  EMPTY_CUSTOM_FILTER_DEFINITION,
  normalizeCustomFilterDefinition,
  describeCustomFilter,
  isEmptyDefinition,
} from '../../utils/customFilters.js';
import CustomFilterDefinitionFields from './CustomFilterDefinitionFields.jsx';

// Settings > Custom Filters. Admins manage site-wide "shared" filters and their
// own "personal" ones here; everyone else creates personal filters inline from
// the Contacts page. Custom filters are the saved filters that Campaigns will
// target and that appear as a dropdown on Contacts.
function emptyForm() {
  return {
    name: '',
    description: '',
    scope: 'shared',
    business_unit: '',
    definition: { ...EMPTY_CUSTOM_FILTER_DEFINITION },
  };
}

export default function CustomFiltersPanel({ isAdmin }) {
  const { showToast } = useToast();
  const [customFilters, setCustomFilters] = useState([]);
  const [personalLimit, setPersonalLimit] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    try {
      const { data } = await api.get('/api/platform/custom-filters');
      setCustomFilters(data.customFilters || []);
      setPersonalLimit(Number.isFinite(data.personalLimit) ? data.personalLimit : -1);
    } catch (e) {
      showToast(e.response?.data?.error || 'Failed to load custom filters.', { variant: 'error' });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const personalCount = customFilters.filter((f) => f.scope === 'personal').length;
  const hasLimit = personalLimit >= 0;
  const personalFull = hasLimit && personalCount >= personalLimit;

  function openCreate() {
    setEditingId(null);
    setForm({ ...emptyForm(), scope: isAdmin ? 'shared' : 'personal' });
    setError('');
    setEditorOpen(true);
  }

  function openEdit(filter) {
    setEditingId(filter.filter_id);
    setForm({
      name: filter.name || '',
      description: filter.description || '',
      scope: filter.scope || 'personal',
      business_unit: filter.business_unit || '',
      definition: normalizeCustomFilterDefinition(filter.definition),
    });
    setError('');
    setEditorOpen(true);
  }

  const setDef = (updater) =>
    setForm((prev) => ({ ...prev, definition: typeof updater === 'function' ? updater(prev.definition) : updater }));

  async function save(e) {
    e.preventDefault();
    if (!form.name.trim()) { setError('A custom filter name is required.'); return; }
    // Warn before creating a shared filter — it becomes visible to everyone in
    // the workspace.
    if (!editingId && form.scope === 'shared') {
      const ok = window.confirm(
        'Create a shared custom filter?\n\nShared filters are visible to everyone in the workspace and can be targeted by any campaign. Only admins can edit or delete them afterwards.',
      );
      if (!ok) return;
    }
    setBusy(true);
    setError('');
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description.trim(),
        business_unit: form.business_unit || null,
        definition: normalizeCustomFilterDefinition(form.definition),
      };
      if (editingId) {
        await api.patch(`/api/platform/custom-filters/${editingId}`, payload);
        showToast('Custom filter updated.', { variant: 'success' });
      } else {
        await api.post('/api/platform/custom-filters', { ...payload, scope: form.scope });
        showToast('Custom filter created.', { variant: 'success' });
      }
      setEditorOpen(false);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save custom filter.');
    } finally {
      setBusy(false);
    }
  }

  async function remove(filter) {
    if (!window.confirm(`Delete custom filter "${filter.name}"? Any campaign targeting it will lose this audience.`)) return;
    try {
      await api.delete(`/api/platform/custom-filters/${filter.filter_id}`);
      showToast('Custom filter deleted.', { variant: 'success' });
      load();
    } catch (err) {
      showToast(err.response?.data?.error || 'Failed to delete custom filter.', { variant: 'error' });
    }
  }

  const shared = customFilters.filter((f) => f.scope === 'shared');
  const personal = customFilters.filter((f) => f.scope === 'personal');

  function FilterRow({ filter }) {
    const ownerName = [filter.owner_first_name, filter.owner_last_name].filter(Boolean).join(' ');
    return (
      <tr>
        <td>
          <div style={{ fontWeight: 600 }}>{filter.name}</div>
          {filter.description ? <div className="muted" style={{ fontSize: '0.82rem' }}>{filter.description}</div> : null}
        </td>
        <td className="muted" style={{ fontSize: '0.85rem' }}>{describeCustomFilter(filter.definition)}</td>
        <td>
          {filter.business_unit ? <span className="badge">{filter.business_unit}</span> : <span className="muted">—</span>}
        </td>
        <td style={{ whiteSpace: 'nowrap' }}>
          {filter.scope === 'shared'
            ? <span className="badge badge-active" title={ownerName ? `Created by ${ownerName}` : undefined}><Users2 size={12} aria-hidden /> Shared</span>
            : <span className="badge"><User size={12} aria-hidden /> Personal</span>}
        </td>
        <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
          <button type="button" className="btn btn-ghost" onClick={() => openEdit(filter)}>Edit</button>
          <button type="button" className="btn btn-ghost" onClick={() => remove(filter)}>Delete</button>
        </td>
      </tr>
    );
  }

  return (
    <div className="card" style={{ marginTop: '1rem' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
        <div>
          <h2 className="settings-section-title" style={{ marginBottom: '0.25rem' }}>Custom Filters</h2>
          <p className="muted" style={{ margin: 0 }}>
            Saved filters over your contacts. <strong>Shared</strong> filters are visible to everyone in the workspace;{' '}
            <strong>personal</strong> filters are only yours. Custom filters power the Contacts dropdown and will be the
            audience Campaigns target.
          </p>
        </div>
        <button type="button" className="btn btn-primary" onClick={openCreate} disabled={!isAdmin && personalFull}>
          <Plus size={18} strokeWidth={2} aria-hidden /> New custom filter
        </button>
      </div>

      {hasLimit && (
        <div className="custom-filter-tracker" role="status">
          <span>{personalCount} of {personalLimit} personal custom filters used</span>
          <span className="custom-filter-tracker__meter" aria-hidden>
            <span style={{ width: `${Math.min(100, (personalCount / personalLimit) * 100)}%` }} />
          </span>
          {personalFull && <span className="custom-filter-tracker__full">Limit reached — delete one to add another.</span>}
        </div>
      )}

      <div className="table-wrap" style={{ marginTop: '1rem' }}>
        <table className="admin-table">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Filters</th>
              <th scope="col">Business unit</th>
              <th scope="col">Visibility</th>
              <th scope="col" style={{ width: '1%' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="muted" style={{ padding: '1rem' }}>Loading custom filters…</td></tr>
            ) : customFilters.length === 0 ? (
              <tr><td colSpan={5} className="muted" style={{ padding: '1rem' }}>No custom filters yet. Create your first one above.</td></tr>
            ) : (
              <>
                {shared.map((f) => <FilterRow key={f.filter_id} filter={f} />)}
                {personal.map((f) => <FilterRow key={f.filter_id} filter={f} />)}
              </>
            )}
          </tbody>
        </table>
      </div>

      {editorOpen && (
        <div className="modal-backdrop">
          <div className="modal-dialog modal-dialog--custom-filter card" role="dialog" aria-modal aria-labelledby="custom-filter-editor-title">
            <div className="modal-dialog__head">
              <h2 id="custom-filter-editor-title" style={{ fontSize: '1.15rem', fontWeight: 700 }}>
                {editingId ? 'Edit custom filter' : 'New custom filter'}
              </h2>
              <button type="button" className="btn btn-ghost modal-dialog__close" onClick={() => setEditorOpen(false)} aria-label="Close">
                <X size={22} aria-hidden />
              </button>
            </div>
            <form onSubmit={save} style={{ marginTop: '1rem' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: '0.75rem' }}>
                <div className="field">
                  <label htmlFor="custom-filter-name">Name *</label>
                  <input id="custom-filter-name" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} required autoFocus />
                </div>
                <div className="field">
                  <label htmlFor="custom-filter-scope">Visibility</label>
                  <select
                    id="custom-filter-scope"
                    value={form.scope}
                    disabled={Boolean(editingId) || !isAdmin}
                    onChange={(e) => setForm((p) => ({ ...p, scope: e.target.value }))}
                  >
                    {isAdmin && <option value="shared">Shared — everyone in the workspace</option>}
                    <option value="personal">Personal — only me</option>
                  </select>
                  {!isAdmin && <p className="muted" style={{ fontSize: '0.8rem', margin: '0.3rem 0 0' }}>Only admins can create shared custom filters.</p>}
                  {editingId && <p className="muted" style={{ fontSize: '0.8rem', margin: '0.3rem 0 0' }}>Visibility can't be changed after creation.</p>}
                </div>
              </div>

              {!editingId && form.scope === 'shared' && (
                <div className="inline-warning" role="alert">
                  <AlertTriangle size={16} strokeWidth={2} aria-hidden />
                  <span>This will be visible to <strong>everyone</strong> in the workspace and targetable by any campaign.</span>
                </div>
              )}

              <div className="field">
                <label htmlFor="custom-filter-description">Description</label>
                <input id="custom-filter-description" value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} placeholder="Optional — what this filter is for" />
              </div>

              <h3 style={{ margin: '0.5rem 0 0.5rem', fontSize: '1rem' }}>Filters</h3>
              <CustomFilterDefinitionFields def={form.definition} setDef={setDef} disabled={busy} idPrefix="custom-filter-editor" />
              <p className="muted" style={{ fontSize: '0.82rem', margin: '0.25rem 0 0' }}>
                {isEmptyDefinition(form.definition)
                  ? 'No filters set — this custom filter will match every contact.'
                  : `Preview: ${describeCustomFilter(form.definition)}`}
              </p>

              {error && <p className="error">{error}</p>}
              <div className="modal-dialog__actions">
                <button className="btn btn-ghost" type="button" onClick={() => setEditorOpen(false)} disabled={busy}>Cancel</button>
                <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? 'Saving…' : (editingId ? 'Save custom filter' : 'Create custom filter')}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
