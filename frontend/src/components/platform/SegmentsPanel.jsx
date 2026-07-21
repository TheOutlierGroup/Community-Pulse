import { useEffect, useState } from 'react';
import { Plus, X, Users2, User } from 'lucide-react';
import api from '../../services/api.js';
import { useToast } from '../shared/ToastProvider.jsx';
import {
  EMPTY_SEGMENT_DEFINITION,
  normalizeSegmentDefinition,
  describeSegment,
  isEmptyDefinition,
} from '../../utils/segments.js';
import SegmentDefinitionFields from './SegmentDefinitionFields.jsx';

// Settings > Segments. Admins manage site-wide "shared" segments and their own
// "personal" ones here; everyone else creates personal segments inline from the
// Contacts page. Segments are the saved filters that Campaigns will target and
// that appear as a dropdown on Contacts.
function emptyForm() {
  return {
    name: '',
    description: '',
    scope: 'shared',
    business_unit: '',
    definition: { ...EMPTY_SEGMENT_DEFINITION },
  };
}

export default function SegmentsPanel({ isAdmin }) {
  const { showToast } = useToast();
  const [segments, setSegments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    try {
      const { data } = await api.get('/api/platform/segments');
      setSegments(data.segments || []);
    } catch (e) {
      showToast(e.response?.data?.error || 'Failed to load segments.', { variant: 'error' });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  function openCreate() {
    setEditingId(null);
    setForm({ ...emptyForm(), scope: isAdmin ? 'shared' : 'personal' });
    setError('');
    setEditorOpen(true);
  }

  function openEdit(segment) {
    setEditingId(segment.segment_id);
    setForm({
      name: segment.name || '',
      description: segment.description || '',
      scope: segment.scope || 'personal',
      business_unit: segment.business_unit || '',
      definition: normalizeSegmentDefinition(segment.definition),
    });
    setError('');
    setEditorOpen(true);
  }

  const setDef = (updater) =>
    setForm((prev) => ({ ...prev, definition: typeof updater === 'function' ? updater(prev.definition) : updater }));

  async function save(e) {
    e.preventDefault();
    if (!form.name.trim()) { setError('A segment name is required.'); return; }
    setBusy(true);
    setError('');
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description.trim(),
        business_unit: form.business_unit || null,
        definition: normalizeSegmentDefinition(form.definition),
      };
      if (editingId) {
        await api.patch(`/api/platform/segments/${editingId}`, payload);
        showToast('Segment updated.', { variant: 'success' });
      } else {
        await api.post('/api/platform/segments', { ...payload, scope: form.scope });
        showToast('Segment created.', { variant: 'success' });
      }
      setEditorOpen(false);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save segment.');
    } finally {
      setBusy(false);
    }
  }

  async function remove(segment) {
    if (!window.confirm(`Delete segment "${segment.name}"? Any campaign targeting it will lose this audience.`)) return;
    try {
      await api.delete(`/api/platform/segments/${segment.segment_id}`);
      showToast('Segment deleted.', { variant: 'success' });
      load();
    } catch (err) {
      showToast(err.response?.data?.error || 'Failed to delete segment.', { variant: 'error' });
    }
  }

  const shared = segments.filter((s) => s.scope === 'shared');
  const personal = segments.filter((s) => s.scope === 'personal');

  function SegmentRow({ segment }) {
    const ownerName = [segment.owner_first_name, segment.owner_last_name].filter(Boolean).join(' ');
    return (
      <tr>
        <td>
          <div style={{ fontWeight: 600 }}>{segment.name}</div>
          {segment.description ? <div className="muted" style={{ fontSize: '0.82rem' }}>{segment.description}</div> : null}
        </td>
        <td className="muted" style={{ fontSize: '0.85rem' }}>{describeSegment(segment.definition)}</td>
        <td>
          {segment.business_unit ? <span className="badge">{segment.business_unit}</span> : <span className="muted">—</span>}
        </td>
        <td style={{ whiteSpace: 'nowrap' }}>
          {segment.scope === 'shared'
            ? <span className="badge badge-active" title={ownerName ? `Created by ${ownerName}` : undefined}><Users2 size={12} aria-hidden /> Shared</span>
            : <span className="badge"><User size={12} aria-hidden /> Personal</span>}
        </td>
        <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
          <button type="button" className="btn btn-ghost" onClick={() => openEdit(segment)}>Edit</button>
          <button type="button" className="btn btn-ghost" onClick={() => remove(segment)}>Delete</button>
        </td>
      </tr>
    );
  }

  return (
    <div className="card" style={{ marginTop: '1rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
        <div>
          <h2 className="settings-section-title" style={{ marginBottom: '0.25rem' }}>Segments</h2>
          <p className="muted" style={{ margin: 0 }}>
            Saved filters over your contacts. <strong>Shared</strong> segments are visible to everyone in the workspace;{' '}
            <strong>personal</strong> segments are only yours. Segments power the Contacts dropdown and will be the audience
            Campaigns target.
          </p>
        </div>
        <button type="button" className="btn btn-primary" onClick={openCreate}>
          <Plus size={18} strokeWidth={2} aria-hidden /> New segment
        </button>
      </div>

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
              <tr><td colSpan={5} className="muted" style={{ padding: '1rem' }}>Loading segments…</td></tr>
            ) : segments.length === 0 ? (
              <tr><td colSpan={5} className="muted" style={{ padding: '1rem' }}>No segments yet. Create your first one above.</td></tr>
            ) : (
              <>
                {shared.map((s) => <SegmentRow key={s.segment_id} segment={s} />)}
                {personal.map((s) => <SegmentRow key={s.segment_id} segment={s} />)}
              </>
            )}
          </tbody>
        </table>
      </div>

      {editorOpen && (
        <div className="modal-backdrop">
          <div className="modal-dialog modal-dialog--wide card" role="dialog" aria-modal aria-labelledby="segment-editor-title">
            <div className="modal-dialog__head">
              <h2 id="segment-editor-title" style={{ fontSize: '1.15rem', fontWeight: 700 }}>
                {editingId ? 'Edit segment' : 'New segment'}
              </h2>
              <button type="button" className="btn btn-ghost modal-dialog__close" onClick={() => setEditorOpen(false)} aria-label="Close">
                <X size={22} aria-hidden />
              </button>
            </div>
            <form onSubmit={save} style={{ marginTop: '1rem' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: '0.75rem' }}>
                <div className="field">
                  <label htmlFor="segment-name">Name *</label>
                  <input id="segment-name" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} required autoFocus />
                </div>
                <div className="field">
                  <label htmlFor="segment-scope">Visibility</label>
                  <select
                    id="segment-scope"
                    value={form.scope}
                    disabled={Boolean(editingId) || !isAdmin}
                    onChange={(e) => setForm((p) => ({ ...p, scope: e.target.value }))}
                  >
                    {isAdmin && <option value="shared">Shared — everyone in the workspace</option>}
                    <option value="personal">Personal — only me</option>
                  </select>
                  {!isAdmin && <p className="muted" style={{ fontSize: '0.8rem', margin: '0.3rem 0 0' }}>Only admins can create shared segments.</p>}
                  {editingId && <p className="muted" style={{ fontSize: '0.8rem', margin: '0.3rem 0 0' }}>Visibility can't be changed after creation.</p>}
                </div>
              </div>
              <div className="field">
                <label htmlFor="segment-description">Description</label>
                <input id="segment-description" value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} placeholder="Optional — what this segment is for" />
              </div>

              <h3 style={{ margin: '0.5rem 0 0.5rem', fontSize: '1rem' }}>Filters</h3>
              <SegmentDefinitionFields def={form.definition} setDef={setDef} disabled={busy} idPrefix="segment-editor" />
              <p className="muted" style={{ fontSize: '0.82rem', margin: '0.25rem 0 0' }}>
                {isEmptyDefinition(form.definition)
                  ? 'No filters set — this segment will match every contact.'
                  : `Preview: ${describeSegment(form.definition)}`}
              </p>

              {error && <p className="error">{error}</p>}
              <div className="modal-dialog__actions">
                <button className="btn btn-ghost" type="button" onClick={() => setEditorOpen(false)} disabled={busy}>Cancel</button>
                <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? 'Saving…' : (editingId ? 'Save segment' : 'Create segment')}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
