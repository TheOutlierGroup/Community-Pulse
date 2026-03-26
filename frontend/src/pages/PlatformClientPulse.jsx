import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useOutletContext } from 'react-router-dom';
import api from '../services/api.js';
import PlatformClientHeader from './PlatformClientHeader.jsx';
import {
  Activity,
  BarChart3,
  Download,
  Gauge,
  LayoutDashboard,
  LineChart,
  SlidersHorizontal,
  Users,
} from 'lucide-react';
import { normalizeServices, sessionStatusLabel } from './platformClientUtils.js';

const PULSE_SECTIONS = [
  { id: 'organisation-dashboard', label: 'Organisation Dashboard', icon: LayoutDashboard },
  { id: 'score-breakdown', label: 'Score Breakdown', icon: BarChart3 },
  { id: 'trend-analysis', label: 'Trend Analysis', icon: LineChart },
  { id: 'manager-load-report', label: 'Manager Load Report', icon: Gauge },
  { id: 'team-level-view', label: 'Team-Level View', icon: Users },
  { id: 'survey-configuration', label: 'Survey Configuration', icon: SlidersHorizontal },
  { id: 'export-data', label: 'Export Data', icon: Download },
];

function toShortDate(value) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export default function PlatformClientPulse() {
  const { org, orgId, clientLogoUrl } = useOutletContext();
  const navigate = useNavigate();
  const location = useLocation();
  const [sessions, setSessions] = useState([]);
  const [error, setError] = useState('');
  const [activeSection, setActiveSection] = useState(PULSE_SECTIONS[0].id);

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
    loadSessions().catch(() => {
      setError('Could not load Pulse dashboard.');
      setSessions([]);
    });
  }, [loadSessions, navigate, orgId, pulseEnabled]);

  useEffect(() => {
    if (!location.hash) return;
    const fromHash = location.hash.replace(/^#/, '').trim();
    if (!PULSE_SECTIONS.some((s) => s.id === fromHash)) return;
    setActiveSection(fromHash);
    const el = document.getElementById(fromHash);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [location.hash]);

  const activeSession = sessions.find((s) => s.status === 'active');
  const countsByStatus = useMemo(
    () =>
      sessions.reduce(
        (acc, session) => {
          if (session.status === 'active') acc.active += 1;
          else if (session.status === 'closed') acc.closed += 1;
          else acc.draft += 1;
          return acc;
        },
        { active: 0, draft: 0, closed: 0 }
      ),
    [sessions]
  );
  const newestSession = sessions[0] || null;
  const monthLabel = new Date().toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });

  function jumpToSection(id) {
    setActiveSection(id);
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    window.history.replaceState(null, '', `#${id}`);
  }

  function exportSessionsCsv() {
    const header = ['Session', 'Status', 'Created', 'Closed'];
    const rows = sessions.map((s) => [s.name, s.status, toShortDate(s.createdAt), toShortDate(s.closedAt)]);
    const csv = [header, ...rows]
      .map((cells) => cells.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${org.name.replaceAll(/\s+/g, '-').toLowerCase()}-pulse-sessions.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="platform-pulse-page">
      <PlatformClientHeader orgName={org.name} logoSrc={clientLogoUrl} />
      <div className="platform-pulse-heading">
        <div>
          <div className="platform-pulse-heading__eyebrow">Client Administration</div>
          <h1 className="platform-pulse-heading__title">Pulse</h1>
        </div>
        <span className="platform-pulse-heading__period">{monthLabel}</span>
      </div>
      {error && <p className="error" style={{ marginBottom: '1rem' }}>{error}</p>}
      <div className="platform-pulse-menu" role="tablist" aria-label="Pulse menu">
        {PULSE_SECTIONS.map((section) => {
          const Icon = section.icon;
          return (
            <button
              key={section.id}
              type="button"
              className={`platform-pulse-menu__item${activeSection === section.id ? ' platform-pulse-menu__item--active' : ''}`}
              onClick={() => jumpToSection(section.id)}
            >
              <Icon size={16} strokeWidth={1.9} aria-hidden />
              {section.label}
            </button>
          );
        })}
      </div>
      <div className="platform-client-dashboard-grid">
        <section
          id="organisation-dashboard"
          className="card platform-client-dashboard__card platform-client-dashboard__card--wide platform-pulse-section"
        >
          <div className="platform-pulse-section__label">Organisation Dashboard</div>
          <h2 className="platform-client-dashboard__h2 platform-pulse-section__title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Activity size={22} strokeWidth={1.75} aria-hidden />
            Change Readiness Pulse Dashboard
          </h2>
          <p className="muted platform-pulse-section__intro" style={{ fontSize: '0.9rem', marginTop: 0 }}>
            Pulse status: <strong>Enabled</strong>. This mirrors the Pulse workspace structure from the client
            prototype with dedicated Pulse sections.
          </p>
          <div className="platform-client-stats platform-pulse-kpis" style={{ marginTop: '1rem' }}>
            <div className="platform-client-stats__tile">
              <div className="platform-client-stats__value">{sessions.length}</div>
              <div className="platform-client-stats__label">Total Sessions</div>
            </div>
            <div className="platform-client-stats__tile">
              <div className="platform-client-stats__value">{countsByStatus.active}</div>
              <div className="platform-client-stats__label">Active</div>
            </div>
            <div className="platform-client-stats__tile">
              <div className="platform-client-stats__value">{countsByStatus.draft}</div>
              <div className="platform-client-stats__label">Draft</div>
            </div>
            <div className="platform-client-stats__tile">
              <div className="platform-client-stats__value">{countsByStatus.closed}</div>
              <div className="platform-client-stats__label">Closed</div>
            </div>
          </div>
          <div className="platform-pulse-summary">
            <div>
              <span className="muted" style={{ fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Active session
              </span>
              <p style={{ margin: '0.25rem 0 0', fontWeight: 600 }}>{activeSession?.name || 'None'}</p>
            </div>
            <div>
              <span className="muted" style={{ fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Latest session
              </span>
              <p style={{ margin: '0.25rem 0 0', fontWeight: 600 }}>{newestSession?.name || 'None'}</p>
            </div>
          </div>
        </section>

        <section id="score-breakdown" className="card platform-pulse-section">
          <div className="platform-pulse-section__label">Overview</div>
          <h3 className="platform-client-dashboard__h2">Score Breakdown</h3>
          <p className="muted" style={{ marginTop: 0 }}>
            Session composition for this client right now.
          </p>
          <div className="platform-pulse-breakdown">
            <div className="platform-pulse-breakdown__row">
              <span>Active sessions</span>
              <strong>{countsByStatus.active}</strong>
            </div>
            <div className="platform-pulse-breakdown__row">
              <span>Draft sessions</span>
              <strong>{countsByStatus.draft}</strong>
            </div>
            <div className="platform-pulse-breakdown__row">
              <span>Closed sessions</span>
              <strong>{countsByStatus.closed}</strong>
            </div>
          </div>
        </section>

        <section id="trend-analysis" className="card platform-pulse-section">
          <div className="platform-pulse-section__label">Overview</div>
          <h3 className="platform-client-dashboard__h2">Trend Analysis</h3>
          {!sessions.length && <p className="muted">No session history yet.</p>}
          {sessions.length > 0 && (
            <div className="table-wrap">
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
                      <td className="muted" style={{ fontSize: '0.85rem' }}>{toShortDate(s.createdAt)}</td>
                      <td className="muted" style={{ fontSize: '0.85rem' }}>{toShortDate(s.closedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section id="manager-load-report" className="card platform-pulse-section">
          <div className="platform-pulse-section__label">People</div>
          <h3 className="platform-client-dashboard__h2">Manager Load Report</h3>
          <p className="muted" style={{ marginBottom: 0 }}>
            Manager load insights are surfaced in each Pulse session analytics report. Select a session from Trend
            Analysis to review current context before rollout decisions.
          </p>
        </section>

        <section id="team-level-view" className="card platform-pulse-section">
          <div className="platform-pulse-section__label">People</div>
          <h3 className="platform-client-dashboard__h2">Team-Level View</h3>
          <p className="muted">
            Team membership and access controls live in client Users.
          </p>
          <button type="button" className="btn btn-ghost" onClick={() => navigate(`/platform/clients/${orgId}/users`)}>
            Open Users
          </button>
        </section>

        <section id="survey-configuration" className="card platform-pulse-section">
          <div className="platform-pulse-section__label">Settings</div>
          <h3 className="platform-client-dashboard__h2">Survey Configuration</h3>
          <p className="muted">
            Pulse availability and service controls are managed from the client Account tab.
          </p>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => navigate(`/platform/clients/${orgId}/account`)}
          >
            Open Account Settings
          </button>
        </section>

        <section id="export-data" className="card platform-pulse-section">
          <div className="platform-pulse-section__label">Settings</div>
          <h3 className="platform-client-dashboard__h2">Export Data</h3>
          <p className="muted">
            Export the current Pulse session register for this client as CSV.
          </p>
          <button type="button" className="btn btn-primary" onClick={exportSessionsCsv} disabled={!sessions.length}>
            Export sessions CSV
          </button>
        </section>
      </div>
    </div>
  );
}
