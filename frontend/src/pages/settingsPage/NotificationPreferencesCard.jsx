import { useEffect, useState } from 'react';
import api from '../../services/api.js';

/**
 * COM-03 user-facing toggles for outbound notifications. Only shows
 * for licensee/platform admins right now since they're the only
 * recipients of expiry warnings and announcement emails.
 */
export default function NotificationPreferencesCard({ user }) {
  const [prefs, setPrefs] = useState({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get('/api/auth/me/notification-preferences');
        if (!cancelled) setPrefs(data?.preferences || {});
      } catch {
        if (!cancelled) setError('Could not load notification preferences.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (user.role !== 'admin') return null;

  async function persist(patch) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const { data } = await api.patch('/api/auth/me/notification-preferences', patch);
      setPrefs(data?.preferences || {});
      setMessage('Saved.');
    } catch (err) {
      setError(err?.response?.data?.error || 'Could not save preferences.');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return null;

  return (
    <div className="card">
      <h2 className="settings-section-title">Notifications</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        Choose which platform-generated emails you'd like to receive.
      </p>
      {error && <p className="error" style={{ marginBottom: '0.5rem' }}>{error}</p>}
      {message && <p className="muted" style={{ marginBottom: '0.5rem' }}>{message}</p>}
      <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
        <input
          type="checkbox"
          checked={!prefs.expiryWarningOptOut}
          onChange={(e) => persist({ expiryWarningOptOut: !e.target.checked })}
          disabled={busy}
        />
        Receive licence-expiry warning emails
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <input
          type="checkbox"
          checked={!prefs.announcementOptOut}
          onChange={(e) => persist({ announcementOptOut: !e.target.checked })}
          disabled={busy}
        />
        Receive platform announcement emails
      </label>
    </div>
  );
}
