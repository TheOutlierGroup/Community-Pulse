import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import api from '../services/api.js';
import PlatformClientHeader from './PlatformClientHeader.jsx';
import { Activity } from 'lucide-react';
import {
  normalizeServices,
  sessionStatusLabel,
} from './platformClientUtils.js';

export default function PlatformClientPulse() {
  const { org, orgId, clientLogoUrl } = useOutletContext();
  const navigate = useNavigate();
  const [sessions, setSessions] = useState([]);
  const [error, setError] = useState('');

  const enabledServices = normalizeServices(org.settings);
  const pulseEnabled = enabledServices.includes('pulse');

  const loadSessions = useCallback(async () => {
    const { data } = await api.get(`/api/platform/organizations/${orgId}/pulse-sessions`);
    setSessions(data.sessions || []);
  }, [orgId]);

  useEffect(() => {
    if (!pulseEnabled) {
      navigate(`/platform/clients/${orgId}/account`, { replace: true });
      return;
    }
    loadSessions().catch(() => setSessions([]));
  }, [loadSessions, navigate, orgId, pulseEnabled]);

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
            Pulse status: <strong>{pulseEnabled ? 'Enabled' : 'Disabled'}</strong>. Manage services from the
            Account tab.
          </p>
          <p className="muted" style={{ fontSize: '0.9rem', marginTop: '0.5rem' }}>
            When Pulse is enabled, this client&apos;s admins can run employee pulse sessions in their dashboard.
            Employees only see Pulse when there is an active session.
          </p>
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
