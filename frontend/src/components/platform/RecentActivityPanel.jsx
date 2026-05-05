import { useEffect, useState } from 'react';
import api from '../../services/api.js';

const ACTION_LABELS = {
  'org.create': 'Organisation created',
  'org.update': 'Organisation updated',
  'org.delete': 'Organisation deleted',
  'org.logo.upload': 'Logo uploaded',
  'org.logo.delete': 'Logo removed',
  'user.invite.send': 'User invited',
  'user.invite.resend': 'Invite resent',
  'user.update': 'User updated',
  'user.deactivate': 'User deactivated',
  'user.password_reset_by_admin': 'Password reset by admin',
  'licence.config.update': 'Licence configuration updated',
  'licence.expiry.sweep': 'Licence expiry sweep run',
  'pulse.session.create': 'Assessment session created',
  'pulse.during_checkpoint.open': 'During-project checkpoint opened',
  'pulse.respondent_cap.override': 'Respondent cap overridden',
  'assessment.consume': 'Assessment opened',
  'assessment.refund': 'Assessment refunded',
  'status_incident.create': 'Status incident posted',
  'status_incident.update': 'Status incident updated',
  'status_incident.resolve': 'Status incident resolved',
  'status_incident.delete': 'Status incident deleted',
};

function describeAction(action) {
  return ACTION_LABELS[action] || action;
}

function formatDate(value) {
  if (!value) return '';
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return '';
  return dt.toLocaleString('en-AU', {
    day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

function describeMetadata(event) {
  if (!event?.metadata || typeof event.metadata !== 'object') return null;
  const m = event.metadata;
  const bits = [];
  if (m.kind) bits.push(m.kind);
  if (Array.isArray(m.patchedFields) && m.patchedFields.length > 0) {
    bits.push(`fields: ${m.patchedFields.slice(0, 4).join(', ')}${m.patchedFields.length > 4 ? '…' : ''}`);
  }
  if (typeof m.notificationsSent === 'number') bits.push(`notifications: ${m.notificationsSent}`);
  if (m.source) bits.push(m.source);
  if (m.severity) bits.push(`severity: ${m.severity}`);
  if (typeof m.previousCap === 'number' || typeof m.nextCap === 'number') {
    bits.push(`cap ${m.previousCap ?? '∅'} → ${m.nextCap ?? '∅'}`);
  }
  return bits.length === 0 ? null : bits.join(' · ');
}

/**
 * INF-03 read surface. Shows the most recent audit events for the
 * current organization, scoped via the backend (platform admins see any
 * org; licensee admins see their own org and any owned client). Polls
 * once on mount; refresh button reloads on demand.
 */
export default function RecentActivityPanel({ orgId }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function reload() {
    if (!orgId) return;
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get(`/api/platform/organizations/${orgId}/audit-events?limit=50`);
      setEvents(Array.isArray(data?.events) ? data.events : []);
    } catch (e) {
      setError(e?.response?.data?.error || 'Could not load recent activity.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reload();
  }, [orgId]);

  return (
    <div className="card platform-client-dashboard__card" style={{ marginBottom: '1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '0.25rem' }}>
        <h2 className="platform-client-dashboard__h2" style={{ margin: 0 }}>
          Recent activity
        </h2>
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
        Audit-logged changes and lifecycle events for this organisation.
      </p>
      {error && <p className="error" style={{ marginBottom: '0.5rem' }}>{error}</p>}
      {!loading && events.length === 0 && (
        <p className="muted" style={{ margin: 0 }}>No recent activity recorded.</p>
      )}
      {events.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: '0.4rem' }}>
          {events.map((event) => {
            const detail = describeMetadata(event);
            return (
              <li
                key={event.id}
                style={{
                  padding: '0.55rem 0.75rem',
                  borderRadius: 6,
                  background: '#fafaf9',
                  border: '1px solid rgba(0,0,0,0.05)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: '1rem',
                  alignItems: 'baseline',
                }}
              >
                <span>
                  <strong>{describeAction(event.action)}</strong>
                  {detail ? (
                    <span className="muted" style={{ marginLeft: '0.5rem', fontSize: '0.8rem' }}>· {detail}</span>
                  ) : null}
                  {event.result && event.result !== 'ok' ? (
                    <span style={{ marginLeft: '0.5rem', color: '#b45309', fontSize: '0.8rem' }}>
                      ({event.result})
                    </span>
                  ) : null}
                </span>
                <span className="muted" style={{ fontSize: '0.75rem', whiteSpace: 'nowrap' }}>
                  {formatDate(event.occurredAt)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
