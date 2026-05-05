import { useEffect, useState } from 'react';
import { Copy, Key, Trash2 } from 'lucide-react';
import api from '../../services/api.js';

function formatDate(iso) {
  if (!iso) return '—';
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return '—';
  return dt.toLocaleString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}

/**
 * SEC-03 admin UI for licensee API keys. Shown to platform admins on
 * any licensee account page, and to licensee admins on their own
 * account page.
 *
 * The plaintext is rendered inline ONCE after creation and then never
 * fetched again (the API never returns it after the create call).
 */
export default function LicenseeApiKeysPanel({ orgId, canManage }) {
  const [keys, setKeys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [justCreated, setJustCreated] = useState(null);

  async function reload() {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get(`/api/platform/organizations/${orgId}/api-keys`);
      setKeys(Array.isArray(data?.apiKeys) ? data.apiKeys : []);
    } catch (e) {
      setError(e?.response?.data?.error || 'Could not load API keys.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (orgId) reload();
  }, [orgId]);

  async function handleCreate(e) {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    setError('');
    try {
      const { data } = await api.post(`/api/platform/organizations/${orgId}/api-keys`, {
        name: newName.trim(),
      });
      setJustCreated({ ...data.apiKey, plaintext: data.plaintext });
      setNewName('');
      await reload();
    } catch (err) {
      setError(err?.response?.data?.error || 'Could not create API key.');
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(keyId) {
    if (!window.confirm('Revoke this API key? Any clients using it will stop working immediately.')) return;
    setError('');
    try {
      await api.delete(`/api/platform/organizations/${orgId}/api-keys/${keyId}`);
      await reload();
    } catch (err) {
      setError(err?.response?.data?.error || 'Could not revoke API key.');
    }
  }

  return (
    <div className="card platform-client-dashboard__card" style={{ marginBottom: '1.5rem' }}>
      <h2 className="platform-client-dashboard__h2" style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <Key size={20} strokeWidth={1.75} aria-hidden /> API keys
      </h2>
      <p className="muted" style={{ margin: '0 0 0.75rem', fontSize: '0.85rem' }}>
        Programmatic read-only access. Available endpoints: <code>GET /api/v1/me</code>, <code>/me/health</code>,
        <code>/me/data-export</code>. Authenticate with <code>Authorization: Bearer rk_...</code>.
      </p>
      {error && <p className="error" style={{ marginBottom: '0.5rem' }}>{error}</p>}

      {justCreated && (
        <div
          style={{
            padding: '0.75rem 1rem',
            borderRadius: 6,
            background: '#fffbeb',
            border: '1px solid #fde68a',
            marginBottom: '1rem',
          }}
        >
          <p style={{ margin: '0 0 0.5rem', fontWeight: 600 }}>
            Copy this token now — it won't be shown again.
          </p>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <code style={{ flex: 1, padding: '0.4rem 0.5rem', background: '#fff', borderRadius: 4, border: '1px solid #e5e7eb', fontSize: '0.85rem', wordBreak: 'break-all' }}>
              {justCreated.plaintext}
            </code>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                navigator.clipboard?.writeText(justCreated.plaintext);
              }}
              aria-label="Copy API key"
              style={{ padding: '0.4rem 0.6rem' }}
            >
              <Copy size={14} aria-hidden />
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setJustCreated(null)}
              style={{ padding: '0.4rem 0.6rem' }}
            >
              Done
            </button>
          </div>
        </div>
      )}

      {canManage && (
        <form onSubmit={handleCreate} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '1rem' }}>
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Name (e.g. CI integration)"
            disabled={creating}
            style={{ flex: 1, maxWidth: 320 }}
            maxLength={100}
            required
          />
          <button type="submit" className="btn btn-primary" disabled={creating || !newName.trim()}>
            {creating ? 'Creating…' : 'Create key'}
          </button>
        </form>
      )}

      {loading && <p className="muted">Loading…</p>}
      {!loading && keys.length === 0 && (
        <p className="muted" style={{ margin: 0 }}>No API keys yet.</p>
      )}
      {keys.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid #e5e7eb' }}>
              <th style={{ padding: '0.35rem 0.5rem' }}>Name</th>
              <th style={{ padding: '0.35rem 0.5rem' }}>Prefix</th>
              <th style={{ padding: '0.35rem 0.5rem' }}>Created</th>
              <th style={{ padding: '0.35rem 0.5rem' }}>Last used</th>
              <th style={{ padding: '0.35rem 0.5rem' }}>Status</th>
              {canManage && <th style={{ padding: '0.35rem 0.5rem' }}></th>}
            </tr>
          </thead>
          <tbody>
            {keys.map((k) => (
              <tr key={k.id} style={{ borderBottom: '1px solid #f3f4f6', opacity: k.revoked ? 0.55 : 1 }}>
                <td style={{ padding: '0.45rem 0.5rem' }}>{k.name}</td>
                <td style={{ padding: '0.45rem 0.5rem' }}><code>{k.prefix}…</code></td>
                <td style={{ padding: '0.45rem 0.5rem' }}>{formatDate(k.createdAt)}</td>
                <td style={{ padding: '0.45rem 0.5rem' }}>{formatDate(k.lastUsedAt)}</td>
                <td style={{ padding: '0.45rem 0.5rem' }}>
                  {k.revoked ? <span style={{ color: '#991b1b' }}>Revoked</span> : <span style={{ color: '#166534' }}>Active</span>}
                </td>
                {canManage && (
                  <td style={{ padding: '0.45rem 0.5rem', textAlign: 'right' }}>
                    {!k.revoked && (
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => handleRevoke(k.id)}
                        aria-label="Revoke key"
                        style={{ padding: '0.25rem 0.4rem' }}
                      >
                        <Trash2 size={14} aria-hidden />
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
