import { useEffect, useState } from 'react';
import { Megaphone, X } from 'lucide-react';
import api from '../../services/api.js';

const DISMISS_KEY = 'pulse_dismissed_announcements';

function readDismissed() {
  try {
    return new Set(JSON.parse(localStorage.getItem(DISMISS_KEY) || '[]'));
  } catch {
    return new Set();
  }
}

function persistDismissed(set) {
  try {
    localStorage.setItem(DISMISS_KEY, JSON.stringify([...set]));
  } catch {
    /* localStorage may be disabled; banner will reappear next load */
  }
}

/**
 * COM-02 in-app announcement banner. Polls /api/platform/announcements/active
 * once on mount and every 5 minutes thereafter. Dismissals are stored
 * in localStorage keyed by announcement id so a closed banner stays
 * closed for that user's browser.
 */
export default function AnnouncementBanner() {
  const [items, setItems] = useState([]);
  const [dismissed, setDismissed] = useState(() => readDismissed());

  useEffect(() => {
    let cancelled = false;
    const fetchActive = async () => {
      try {
        const { data } = await api.get('/api/platform/announcements/active');
        if (!cancelled) setItems(Array.isArray(data?.announcements) ? data.announcements : []);
      } catch {
        // Silent — banner is best-effort.
      }
    };
    fetchActive();
    const id = setInterval(fetchActive, 5 * 60 * 1000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const visible = items.filter((a) => !dismissed.has(a.id));
  if (visible.length === 0) return null;
  const a = visible[0];

  function dismiss() {
    const next = new Set(dismissed);
    next.add(a.id);
    setDismissed(next);
    persistDismissed(next);
  }

  return (
    <div
      role="status"
      style={{
        background: '#dbeafe',
        color: '#1e3a8a',
        padding: '0.6rem 1rem',
        display: 'flex',
        alignItems: 'flex-start',
        gap: '0.75rem',
        borderBottom: '1px solid #93c5fd',
        fontSize: '0.85rem',
      }}
    >
      <Megaphone size={18} aria-hidden style={{ flexShrink: 0, marginTop: 2 }} />
      <div style={{ flex: 1 }}>
        <strong>{a.title}</strong>
        <div style={{ marginTop: 2, whiteSpace: 'pre-wrap' }}>{a.body}</div>
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss announcement"
        style={{
          background: 'transparent',
          border: 'none',
          color: '#1e3a8a',
          cursor: 'pointer',
          padding: 0,
          flexShrink: 0,
        }}
      >
        <X size={16} aria-hidden />
      </button>
    </div>
  );
}
