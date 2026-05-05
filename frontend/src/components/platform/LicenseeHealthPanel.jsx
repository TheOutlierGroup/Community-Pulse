import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../services/api.js';

const HEALTH_BADGE = {
  healthy: { label: 'Healthy', bg: '#dcfce7', fg: '#166534' },
  inactive: { label: 'Inactive 30d+', bg: '#fef9c3', fg: '#854d0e' },
  never_logged_in: { label: 'Never logged in', bg: '#fee2e2', fg: '#991b1b' },
  quota_exhausted: { label: 'Quota exhausted', bg: '#fee2e2', fg: '#991b1b' },
  expired: { label: 'Expired', bg: '#fee2e2', fg: '#991b1b' },
  suspended: { label: 'Suspended', bg: '#fde68a', fg: '#92400e' },
  unmanaged: { label: 'No licence row', bg: '#e5e7eb', fg: '#374151' },
};

function HealthBadge({ status }) {
  const meta = HEALTH_BADGE[status] || { label: status || '—', bg: '#e5e7eb', fg: '#374151' };
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '0.15rem 0.55rem',
        borderRadius: 999,
        fontSize: '0.75rem',
        fontWeight: 600,
        background: meta.bg,
        color: meta.fg,
      }}
    >
      {meta.label}
    </span>
  );
}

function formatDate(value) {
  if (!value) return '—';
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return '—';
  return dt.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}

const SORTS = {
  name: (a, b) => a.organizationName.localeCompare(b.organizationName),
  health: (a, b) => a.healthStatus.localeCompare(b.healthStatus),
  lastLogin: (a, b) => {
    const ax = a.lastLoginAt ? new Date(a.lastLoginAt).getTime() : 0;
    const bx = b.lastLoginAt ? new Date(b.lastLoginAt).getTime() : 0;
    return bx - ax;
  },
  quota: (a, b) => (b.quotaBurnPct ?? -1) - (a.quotaBurnPct ?? -1),
  activity: (a, b) => (b.recentActivityCount || 0) - (a.recentActivityCount || 0),
};

export default function LicenseeHealthPanel() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sortKey, setSortKey] = useState('health');

  async function reload() {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get('/api/platform/licensee-health');
      setItems(Array.isArray(data?.licensees) ? data.licensees : []);
    } catch (e) {
      setError(e?.response?.data?.error || 'Could not load licensee health.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reload();
  }, []);

  const sorted = useMemo(() => {
    const copy = [...items];
    copy.sort(SORTS[sortKey] || SORTS.health);
    return copy;
  }, [items, sortKey]);

  return (
    <div className="card" style={{ marginBottom: '1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '0.25rem' }}>
        <h2 style={{ margin: 0 }}>Licensee health</h2>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={reload}
          disabled={loading}
          style={{ fontSize: '0.8rem', padding: '0.2rem 0.6rem' }}
        >
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>
      <p className="muted" style={{ margin: '0 0 0.75rem', fontSize: '0.85rem' }}>
        Operational snapshot for every licensee — last login, recent activity, and quota burn.
      </p>
      {error && <p className="error" style={{ marginBottom: '0.5rem' }}>{error}</p>}
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.5rem' }}>
        <label htmlFor="health-sort" style={{ fontSize: '0.8rem' }}>Sort by:</label>
        <select
          id="health-sort"
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value)}
          style={{ fontSize: '0.85rem' }}
        >
          <option value="health">Health (worst first)</option>
          <option value="name">Name (A–Z)</option>
          <option value="lastLogin">Last login (recent first)</option>
          <option value="quota">Quota burn (highest first)</option>
          <option value="activity">Recent activity (most first)</option>
        </select>
      </div>
      {!loading && sorted.length === 0 && (
        <p className="muted" style={{ margin: 0 }}>No licensees found.</p>
      )}
      {sorted.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid #e5e7eb' }}>
                <th style={{ padding: '0.35rem 0.5rem' }}>Licensee</th>
                <th style={{ padding: '0.35rem 0.5rem' }}>Health</th>
                <th style={{ padding: '0.35rem 0.5rem' }}>Last login</th>
                <th style={{ padding: '0.35rem 0.5rem' }}>Active users</th>
                <th style={{ padding: '0.35rem 0.5rem' }}>Activity (30d)</th>
                <th style={{ padding: '0.35rem 0.5rem' }}>Quota</th>
                <th style={{ padding: '0.35rem 0.5rem' }}>Contract end</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((row) => (
                <tr key={row.organizationId} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <td style={{ padding: '0.45rem 0.5rem' }}>
                    <Link to={`/platform/clients/${row.organizationId}/account`}>
                      {row.organizationName}
                    </Link>
                  </td>
                  <td style={{ padding: '0.45rem 0.5rem' }}>
                    <HealthBadge status={row.healthStatus} />
                  </td>
                  <td style={{ padding: '0.45rem 0.5rem' }}>{formatDate(row.lastLoginAt)}</td>
                  <td style={{ padding: '0.45rem 0.5rem' }}>
                    {row.activeAdmins} admin{row.activeAdmins === 1 ? '' : 's'}
                    {row.activeMembers ? ` · ${row.activeMembers} other${row.activeMembers === 1 ? '' : 's'}` : ''}
                  </td>
                  <td style={{ padding: '0.45rem 0.5rem' }}>{row.recentActivityCount}</td>
                  <td style={{ padding: '0.45rem 0.5rem' }}>
                    {row.assessmentsIncluded
                      ? `${row.assessmentsConsumed ?? 0} / ${row.assessmentsIncluded}${
                          row.quotaBurnPct != null ? ` (${row.quotaBurnPct}%)` : ''
                        }`
                      : '—'}
                  </td>
                  <td style={{ padding: '0.45rem 0.5rem' }}>{formatDate(row.contractEnd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
