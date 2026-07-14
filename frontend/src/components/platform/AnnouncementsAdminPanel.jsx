import { useEffect, useState } from 'react';
import api from '../../services/api.js';

const AUDIENCE_OPTIONS = [
  { value: 'all', label: 'Everyone (platform + Practitioner admins)' },
  { value: 'licensee', label: 'Practitioner admins only' },
  { value: 'platform', label: 'Platform admins only' },
];

function formatDate(iso) {
  if (!iso) return '—';
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return '—';
  return dt.toLocaleString(undefined, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function AnnouncementsAdminPanel() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [audience, setAudience] = useState('all');
  const [banner, setBanner] = useState(true);
  const [emailOnPublish, setEmailOnPublish] = useState(false);
  const [expiresAt, setExpiresAt] = useState('');
  const [busy, setBusy] = useState(false);

  async function reload() {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get('/api/platform/announcements');
      setItems(Array.isArray(data?.announcements) ? data.announcements : []);
    } catch (e) {
      setError(e?.response?.data?.error || 'Could not load announcements.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { reload(); }, []);

  async function handleCreate(e) {
    e.preventDefault();
    if (!title.trim() || !body.trim()) return;
    setBusy(true);
    setError('');
    try {
      await api.post('/api/platform/announcements', {
        title: title.trim(),
        body: body.trim(),
        audience,
        banner,
        emailOnPublish,
        expiresAt: expiresAt || null,
      });
      setTitle('');
      setBody('');
      setExpiresAt('');
      setEmailOnPublish(false);
      await reload();
    } catch (err) {
      setError(err?.response?.data?.error || 'Could not create announcement.');
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id) {
    if (!window.confirm('Delete this announcement?')) return;
    try {
      await api.delete(`/api/platform/announcements/${id}`);
      await reload();
    } catch (err) {
      setError(err?.response?.data?.error || 'Could not delete announcement.');
    }
  }

  async function handleBroadcast(id) {
    if (!window.confirm('Send this announcement as an email to all admins in its audience?')) return;
    try {
      await api.post(`/api/platform/announcements/${id}/broadcast`);
      await reload();
    } catch (err) {
      setError(err?.response?.data?.error || 'Could not broadcast.');
    }
  }

  return (
    <div className="card" style={{ marginBottom: '1.5rem' }}>
      <h2 style={{ marginTop: 0 }}>Platform announcements</h2>
      <p className="muted" style={{ margin: '0 0 0.75rem', fontSize: '0.85rem' }}>
        Product news, policy updates, end-of-year notes. For outages or maintenance, use Status incidents instead.
      </p>
      {error && <p className="error" style={{ marginBottom: '0.5rem' }}>{error}</p>}

      <form onSubmit={handleCreate} style={{ display: 'grid', gap: '0.5rem', marginBottom: '1rem', padding: '0.75rem', border: '1px dashed #d6d3d1', borderRadius: 6 }}>
        <div className="field">
          <label htmlFor="ann-title">Title</label>
          <input id="ann-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} required />
        </div>
        <div className="field">
          <label htmlFor="ann-body">Body</label>
          <textarea id="ann-body" value={body} onChange={(e) => setBody(e.target.value)} rows={4} maxLength={8000} required />
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div className="field" style={{ flex: 1, minWidth: 220 }}>
            <label htmlFor="ann-aud">Audience</label>
            <select id="ann-aud" value={audience} onChange={(e) => setAudience(e.target.value)}>
              {AUDIENCE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div className="field" style={{ minWidth: 180 }}>
            <label htmlFor="ann-exp">Expires at (optional)</label>
            <input id="ann-exp" type="datetime-local" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
          </div>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <input type="checkbox" checked={banner} onChange={(e) => setBanner(e.target.checked)} /> Show as in-app banner
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <input type="checkbox" checked={emailOnPublish} onChange={(e) => setEmailOnPublish(e.target.checked)} />
          Also send as email broadcast immediately
        </label>
        <div>
          <button type="submit" className="btn btn-primary" disabled={busy || !title.trim() || !body.trim()}>
            {busy ? 'Publishing…' : 'Publish announcement'}
          </button>
        </div>
      </form>

      {loading && <p className="muted">Loading…</p>}
      {!loading && items.length === 0 && <p className="muted" style={{ margin: 0 }}>No announcements yet.</p>}
      {items.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: '0.5rem' }}>
          {items.map((a) => (
            <li key={a.id} style={{ padding: '0.6rem 0.75rem', borderRadius: 6, background: '#fafaf9', border: '1px solid rgba(0,0,0,0.06)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '1rem' }}>
                <div>
                  <strong>{a.title}</strong>
                  <div className="muted" style={{ fontSize: '0.8rem' }}>
                    {a.audience} · published {formatDate(a.publishedAt)} {a.expiresAt ? `· expires ${formatDate(a.expiresAt)}` : ''} {a.emailSentAt ? `· broadcast ${formatDate(a.emailSentAt)} (${a.emailRecipientsCount || 0})` : ''}
                  </div>
                  <pre style={{ marginTop: '0.4rem', whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: '0.85rem' }}>{a.body}</pre>
                </div>
                <div style={{ display: 'flex', gap: '0.4rem' }}>
                  {!a.emailSentAt && (
                    <button type="button" className="btn btn-secondary" style={{ padding: '0.2rem 0.5rem', fontSize: '0.8rem' }} onClick={() => handleBroadcast(a.id)}>
                      Email
                    </button>
                  )}
                  <button type="button" className="btn btn-ghost" style={{ padding: '0.2rem 0.5rem', fontSize: '0.8rem', color: '#991b1b' }} onClick={() => handleDelete(a.id)}>
                    Delete
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
