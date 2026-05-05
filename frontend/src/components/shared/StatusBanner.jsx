import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../services/api.js';

const SEVERITY_BG = {
  critical: '#7f1d1d',
  major: '#c2410c',
  minor: '#a16207',
  maintenance: '#1d4ed8',
};

const STORAGE_KEY = 'platformStatusBannerDismissedIds:v1';
const POLL_INTERVAL_MS = 60_000;

function readDismissed() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw));
  } catch {
    return new Set();
  }
}

function persistDismissed(set) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...set]));
  } catch {
    /* ignore */
  }
}

/**
 * INF-08 in-app banner. Polls the public status feed (no auth required)
 * and surfaces the highest-severity active incident across the top of
 * the logged-in UI. Each user can dismiss by incident id; once that
 * incident resolves we drop it from localStorage so the slot can show
 * future incidents without clutter.
 */
export default function StatusBanner() {
  const [activeIncidents, setActiveIncidents] = useState([]);
  const [dismissed, setDismissed] = useState(() => readDismissed());

  useEffect(() => {
    let cancelled = false;
    let timer = null;

    async function fetchOnce() {
      try {
        const { data } = await api.get('/api/status');
        if (cancelled) return;
        const next = Array.isArray(data?.activeIncidents) ? data.activeIncidents : [];
        setActiveIncidents(next);
        if (next.length === 0 && dismissed.size > 0) {
          setDismissed((prev) => {
            const cleared = new Set();
            persistDismissed(cleared);
            return cleared;
          });
        }
      } catch {
        // The banner is best-effort chrome — never break the layout if
        // the status feed is briefly unreachable.
      }
    }

    fetchOnce();
    timer = setInterval(fetchOnce, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [dismissed.size]);

  const visible = activeIncidents
    .filter((i) => !dismissed.has(i.id))
    .sort((a, b) => severityScore(b.severity) - severityScore(a.severity));
  if (visible.length === 0) return null;
  const top = visible[0];

  function dismiss(id) {
    const next = new Set(dismissed);
    next.add(id);
    persistDismissed(next);
    setDismissed(next);
  }

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        background: SEVERITY_BG[top.severity] || '#1c1917',
        color: '#fff',
        padding: '0.6rem 1rem',
        display: 'flex',
        alignItems: 'center',
        gap: '0.75rem',
        flexWrap: 'wrap',
      }}
    >
      <strong style={{ fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        {top.severity}
      </strong>
      <span style={{ fontWeight: 600 }}>{top.title}</span>
      <span style={{ flex: 1, fontSize: '0.9rem', opacity: 0.92, minWidth: 200 }}>
        {top.body}
      </span>
      <Link
        to="/status"
        style={{ color: '#fff', textDecoration: 'underline', fontSize: '0.85rem' }}
      >
        Status page
      </Link>
      <button
        type="button"
        onClick={() => dismiss(top.id)}
        style={{
          background: 'transparent',
          color: '#fff',
          border: '1px solid rgba(255,255,255,0.4)',
          borderRadius: 6,
          padding: '0.2rem 0.55rem',
          fontSize: '0.8rem',
          cursor: 'pointer',
        }}
      >
        Dismiss
      </button>
    </div>
  );
}

function severityScore(severity) {
  return { critical: 4, major: 3, minor: 2, maintenance: 1 }[severity] || 0;
}
