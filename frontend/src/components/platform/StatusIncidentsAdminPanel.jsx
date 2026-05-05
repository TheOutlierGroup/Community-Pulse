import { useEffect, useState } from 'react';
import api from '../../services/api.js';

const SEVERITIES = [
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'minor', label: 'Minor' },
  { value: 'major', label: 'Major' },
  { value: 'critical', label: 'Critical' },
];

function formatDate(value) {
  if (!value) return '';
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return '';
  return dt.toLocaleString('en-AU', {
    day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

/**
 * INF-08 admin surface for platform status incidents. Lives on
 * PlatformSettings so platform admins have one place to manage
 * platform-wide chrome (banners + status page entries) without a
 * separate dedicated page.
 */
export default function StatusIncidentsAdminPanel() {
  const [incidents, setIncidents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [severity, setSeverity] = useState('maintenance');

  async function reload() {
    setLoading(true);
    try {
      const { data } = await api.get('/api/platform/status-incidents');
      setIncidents(Array.isArray(data?.incidents) ? data.incidents : []);
    } catch (e) {
      setError(e?.response?.data?.error || 'Could not load incidents.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reload();
  }, []);

  async function create(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.post('/api/platform/status-incidents', { title, body, severity });
      setTitle('');
      setBody('');
      setSeverity('maintenance');
      await reload();
    } catch (err) {
      setError(err?.response?.data?.error || 'Could not create incident.');
    } finally {
      setBusy(false);
    }
  }

  async function resolve(id) {
    if (!window.confirm('Mark this incident as resolved?')) return;
    setBusy(true);
    try {
      await api.post(`/api/platform/status-incidents/${id}/resolve`);
      await reload();
    } catch (err) {
      setError(err?.response?.data?.error || 'Could not resolve incident.');
    } finally {
      setBusy(false);
    }
  }

  async function destroy(id) {
    if (!window.confirm('Delete this incident? This is permanent.')) return;
    setBusy(true);
    try {
      await api.delete(`/api/platform/status-incidents/${id}`);
      await reload();
    } catch (err) {
      setError(err?.response?.data?.error || 'Could not delete incident.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ marginTop: '1rem' }}>
      <h2 className="settings-section-title">Status incidents</h2>
      <p className="muted" style={{ margin: '0 0 0.75rem' }}>
        Anything posted here appears on the public <strong>/status</strong> page and as a banner
        across logged-in workspaces. Resolve incidents when service is restored.
      </p>
      {error && <p className="error" style={{ marginBottom: '0.5rem' }}>{error}</p>}

      <form onSubmit={create} style={{ display: 'grid', gap: '0.6rem', marginBottom: '1.25rem' }}>
        <div className="field">
          <label htmlFor="status-title">Title</label>
          <input
            id="status-title"
            type="text"
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={busy}
            maxLength={140}
          />
        </div>
        <div className="field">
          <label htmlFor="status-body">Message</label>
          <textarea
            id="status-body"
            required
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={3}
            disabled={busy}
          />
        </div>
        <div className="field" style={{ maxWidth: 240 }}>
          <label htmlFor="status-severity">Severity</label>
          <select
            id="status-severity"
            value={severity}
            onChange={(e) => setSeverity(e.target.value)}
            disabled={busy}
          >
            {SEVERITIES.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>
        <div>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Saving…' : 'Post incident'}
          </button>
        </div>
      </form>

      <h3 style={{ margin: '0 0 0.5rem', fontSize: '0.95rem' }}>Recent incidents</h3>
      {loading && <p className="muted">Loading…</p>}
      {!loading && incidents.length === 0 && (
        <p className="muted">No incidents yet.</p>
      )}
      {!loading && incidents.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: '0.5rem' }}>
          {incidents.map((i) => (
            <li
              key={i.id}
              style={{
                padding: '0.7rem 0.85rem',
                borderRadius: 6,
                background: '#fafaf9',
                border: '1px solid rgba(0,0,0,0.06)',
                display: 'grid',
                gap: '0.4rem',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '1rem' }}>
                <div>
                  <strong>{i.title}</strong>
                  <span className="muted" style={{ marginLeft: '0.5rem', fontSize: '0.8rem' }}>
                    · {i.severity}
                    {i.isActive ? ' · active' : ' · resolved'}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: '0.4rem' }}>
                  {i.isActive && (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => resolve(i.id)}
                      disabled={busy}
                      style={{ fontSize: '0.8rem', padding: '0.25rem 0.6rem' }}
                    >
                      Resolve
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => destroy(i.id)}
                    disabled={busy}
                    style={{ fontSize: '0.8rem', padding: '0.25rem 0.6rem' }}
                  >
                    Delete
                  </button>
                </div>
              </div>
              <p style={{ margin: 0, color: '#44403c', whiteSpace: 'pre-wrap', fontSize: '0.9rem' }}>{i.body}</p>
              <div className="muted" style={{ fontSize: '0.75rem' }}>
                Started {formatDate(i.startedAt)}
                {i.resolvedAt ? ` · Resolved ${formatDate(i.resolvedAt)}` : ''}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
