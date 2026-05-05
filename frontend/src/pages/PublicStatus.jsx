import { useEffect, useState } from 'react';
import api from '../services/api.js';
import Layout from '../components/shared/Layout.jsx';

const SEVERITY_LABEL = {
  critical: 'Critical incident',
  major: 'Major incident',
  minor: 'Minor incident',
  maintenance: 'Maintenance',
};

const SEVERITY_COLOR = {
  critical: '#b91c1c',
  major: '#c2410c',
  minor: '#a16207',
  maintenance: '#1d4ed8',
};

function formatDate(value) {
  if (!value) return '';
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return '';
  return dt.toLocaleString('en-AU', {
    day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

export default function PublicStatus() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .get('/api/status')
      .then(({ data: payload }) => { if (!cancelled) setData(payload); })
      .catch(() => { if (!cancelled) setError('Could not load status.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const overall = data?.overallStatus || 'operational';
  const overallLabel = overall === 'operational' ? 'All systems operational' : SEVERITY_LABEL[overall] || overall;
  const overallColor = overall === 'operational' ? '#15803d' : SEVERITY_COLOR[overall] || '#1c1917';

  return (
    <Layout user={null} onLogout={() => {}}>
      <div className="card" style={{ maxWidth: 760, margin: '0 auto', padding: '2rem 1.75rem' }}>
        <h1 style={{ margin: '0 0 0.25rem', fontSize: '1.6rem' }}>Platform status</h1>
        <p className="muted" style={{ margin: '0 0 1.5rem' }}>
          Live operational status for Outlier’s Rhythm Engine and CRM platforms.
        </p>

        <div
          style={{
            padding: '1rem 1.25rem',
            borderRadius: 8,
            background: overall === 'operational' ? '#dcfce7' : '#fef3c7',
            color: overallColor,
            fontWeight: 600,
            marginBottom: '1.5rem',
          }}
        >
          {overallLabel}
        </div>

        {loading && <p className="muted">Loading…</p>}
        {error && <p className="error">{error}</p>}

        {data && data.activeIncidents.length > 0 && (
          <section style={{ marginBottom: '2rem' }}>
            <h2 style={{ fontSize: '1.05rem', margin: '0 0 0.75rem' }}>Active incidents</h2>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: '0.75rem' }}>
              {data.activeIncidents.map((i) => (
                <li
                  key={i.id}
                  style={{
                    border: `1px solid ${SEVERITY_COLOR[i.severity] || '#d6d3d1'}`,
                    borderLeftWidth: 6,
                    borderRadius: 8,
                    padding: '0.85rem 1rem',
                    background: '#fff',
                  }}
                >
                  <div
                    style={{
                      fontSize: '0.78rem',
                      textTransform: 'uppercase',
                      letterSpacing: '0.08em',
                      color: SEVERITY_COLOR[i.severity],
                      fontWeight: 700,
                      marginBottom: '0.25rem',
                    }}
                  >
                    {SEVERITY_LABEL[i.severity] || i.severity}
                  </div>
                  <div style={{ fontWeight: 600, fontSize: '1rem' }}>{i.title}</div>
                  <p style={{ margin: '0.4rem 0', color: '#44403c', whiteSpace: 'pre-wrap' }}>{i.body}</p>
                  <div className="muted" style={{ fontSize: '0.8rem' }}>Started {formatDate(i.startedAt)}</div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {data && (
          <section>
            <h2 style={{ fontSize: '1.05rem', margin: '0 0 0.75rem' }}>Recent history</h2>
            {data.recentIncidents.length === 0 && (
              <p className="muted">No incidents recorded.</p>
            )}
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: '0.5rem' }}>
              {data.recentIncidents.map((i) => (
                <li
                  key={i.id}
                  style={{
                    padding: '0.6rem 0.75rem',
                    borderRadius: 6,
                    background: '#fafaf9',
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: '1rem',
                    alignItems: 'baseline',
                  }}
                >
                  <span>
                    <strong>{i.title}</strong>{' '}
                    <span className="muted" style={{ fontSize: '0.8rem' }}>
                      · {SEVERITY_LABEL[i.severity] || i.severity}
                      {i.resolvedAt ? ' · resolved' : ' · ongoing'}
                    </span>
                  </span>
                  <span className="muted" style={{ fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
                    {formatDate(i.startedAt)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </Layout>
  );
}
