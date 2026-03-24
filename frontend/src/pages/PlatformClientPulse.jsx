import { useCallback, useEffect, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import api from '../services/api.js';
import { useToast } from '../components/shared/ToastProvider.jsx';
import PlatformClientHeader from './PlatformClientHeader.jsx';
import { Activity } from 'lucide-react';
import { normalizeSettings, sessionStatusLabel } from './platformClientUtils.js';

export default function PlatformClientPulse() {
  const { org, orgId, refreshOrg, clientLogoUrl } = useOutletContext();
  const { showToast } = useToast();
  const [sessions, setSessions] = useState([]);
  const [pulseBusy, setPulseBusy] = useState(false);
  const [error, setError] = useState('');

  const settings = normalizeSettings(org.settings);
  const pulseEnabled = settings.pulseEnabled === true;

  const loadSessions = useCallback(async () => {
    const { data } = await api.get(`/api/platform/organizations/${orgId}/pulse-sessions`);
    setSessions(data.sessions || []);
  }, [orgId]);

  useEffect(() => {
    loadSessions().catch(() => setSessions([]));
  }, [loadSessions]);

  async function togglePulse(next) {
    setPulseBusy(true);
    setError('');
    try {
      const nextSettings = { ...normalizeSettings(org.settings), pulseEnabled: next };
      await api.patch(`/api/platform/organizations/${orgId}`, {
        settings: nextSettings,
      });
      await refreshOrg();
      showToast(next ? 'Pulse is on for this client.' : 'Pulse is off for this client.', {
        variant: 'success',
      });
    } catch (err) {
      setError(err.response?.data?.error || 'Could not update Pulse setting.');
    } finally {
      setPulseBusy(false);
    }
  }

  const activeSession = sessions.find((s) => s.status === 'active');

  return (
    <>
      <PlatformClientHeader orgName={org.name} logoSrc={clientLogoUrl} />
      {error && <p className="error" style={{ marginBottom: '1rem' }}>{error}</p>}
      <div className="platform-client-dashboard-grid">
        <div className="card platform-client-dashboard__card platform-client-dashboard__card--wide">
          <h2 className="platform-client-dashboard__h2" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Activity size={22} strokeWidth={1.75} aria-hidden />
            Pulse
          </h2>
          <p className="muted" style={{ fontSize: '0.9rem', marginTop: 0 }}>
            When Pulse is on, this client&apos;s admins can run employee pulse sessions in their dashboard.
            Employees only see Pulse when there is an active session.
          </p>
          <div className="platform-pulse-toggle-row">
            <label className="platform-toggle">
              <input
                type="checkbox"
                checked={pulseEnabled}
                disabled={pulseBusy}
                onChange={(e) => togglePulse(e.target.checked)}
              />
              <span className="platform-toggle__slider" aria-hidden />
              <span className="platform-toggle__label">Pulse enabled for this client</span>
            </label>
          </div>
          <div className="platform-pulse-summary">
            <div>
              <span className="muted" style={{ fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Active session
              </span>
              <p style={{ margin: '0.25rem 0 0', fontWeight: 600 }}>
                {activeSession ? activeSession.name : 'None'}
              </p>
            </div>
            <div>
              <span className="muted" style={{ fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Total sessions
              </span>
              <p style={{ margin: '0.25rem 0 0', fontWeight: 600 }}>{sessions.length}</p>
            </div>
          </div>
          {sessions.length > 0 && (
            <div className="table-wrap" style={{ marginTop: '1rem' }}>
              <table className="admin-table">
                <thead>
                  <tr>
                    <th scope="col">Session</th>
                    <th scope="col">Status</th>
                    <th scope="col">Created</th>
                    <th scope="col">Closed</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((s) => (
                    <tr key={s.id}>
                      <td>{s.name}</td>
                      <td>
                        <span
                          className={`badge badge-${s.status === 'active' ? 'active' : s.status === 'closed' ? 'closed' : 'draft'}`}
                        >
                          {sessionStatusLabel(s.status)}
                        </span>
                      </td>
                      <td className="muted" style={{ fontSize: '0.85rem' }}>
                        {s.createdAt
                          ? new Date(s.createdAt).toLocaleDateString(undefined, {
                              year: 'numeric',
                              month: 'short',
                              day: 'numeric',
                            })
                          : '—'}
                      </td>
                      <td className="muted" style={{ fontSize: '0.85rem' }}>
                        {s.closedAt
                          ? new Date(s.closedAt).toLocaleDateString(undefined, {
                              year: 'numeric',
                              month: 'short',
                              day: 'numeric',
                            })
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
