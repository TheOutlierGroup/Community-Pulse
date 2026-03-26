import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate, useOutletContext } from 'react-router-dom';
import api from '../services/api.js';
import { Activity } from 'lucide-react';
import { normalizeServices } from './platformClientUtils.js';

const PULSE_SECTION_IDS = [
  'organisation-dashboard',
  'organisation-scores',
  'employee-breakdown',
  'team-level-view',
  'manager-load-report',
];

function formatScore(value) {
  if (value == null || Number.isNaN(value)) return '—';
  return value.toFixed(1);
}

function deltaLabel(value) {
  if (value == null || Number.isNaN(value)) return 'No prior period';
  if (value > 0) return `+${value.toFixed(1)} vs previous`;
  if (value < 0) return `${value.toFixed(1)} vs previous`;
  return 'No change vs previous';
}

function shortDelta(value) {
  if (value == null || Number.isNaN(value)) return 'No prior';
  if (value > 0) return `+${value.toFixed(1)}`;
  if (value < 0) return `${value.toFixed(1)}`;
  return '0.0';
}

export default function PlatformClientPulse() {
  const { orgId } = useOutletContext();
  const navigate = useNavigate();
  const location = useLocation();
  const [dashboard, setDashboard] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const enabledServices = normalizeServices(org.settings);
  const pulseEnabled = enabledServices.includes('pulse');

  const loadDashboard = useCallback(() => {
    setLoading(true);
    api
      .get(`/api/platform/organizations/${orgId}/pulse-dashboard`)
      .then(({ data }) => {
        setDashboard(data || null);
        setError('');
      })
      .catch(() => {
        setError('Could not load Pulse dashboard data.');
        setDashboard(null);
      })
      .finally(() => setLoading(false));
  }, [orgId]);

  useEffect(() => {
    if (!pulseEnabled) {
      navigate(`/platform/clients/${orgId}/account`, { replace: true });
      return;
    }
    loadDashboard();
  }, [navigate, orgId, pulseEnabled, loadDashboard]);

  useEffect(() => {
    if (!location.hash) return;
    const fromHash = location.hash.replace(/^#/, '').trim();
    if (!PULSE_SECTION_IDS.includes(fromHash)) return;
    const el = document.getElementById(fromHash);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [location.hash]);

  const sessions = dashboard?.sessions || [];
  const kpis = dashboard?.kpis || {};
  const currentSession = dashboard?.currentSession || null;
  const newestSession = sessions[0] || null;
  const monthLabel = new Date().toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });
  const roleBreakdown = [
    { label: 'Employee', value: kpis.completedEmployees ?? 0, trend: kpis.employeeParticipationRate ?? 0 },
    { label: 'Manager', value: kpis.completedManagers ?? 0, trend: kpis.managerParticipationRate ?? 0 },
  ];
  const trendBars = (dashboard?.trend || []).slice(0, 4);
  const maxTrendScore = Math.max(
    40,
    ...trendBars.flatMap((item) => [
      item?.adoptionScore || 0,
      item?.sponsorshipScore || 0,
    ])
  );

  return (
    <div className="platform-pulse-page">
      <div className="platform-pulse-heading">
        <div>
          <div className="platform-pulse-heading__eyebrow">Client Administration</div>
          <h1 className="platform-pulse-heading__title">Organisation Dashboard</h1>
        </div>
        <div className="platform-pulse-heading__right">
          <span className="platform-pulse-heading__period">{monthLabel}</span>
          <button type="button" className="btn btn-ghost" onClick={loadDashboard} disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>
      {error && <p className="error" style={{ marginBottom: '1rem' }}>{error}</p>}
      {loading && <p className="muted" style={{ marginBottom: '1rem' }}>Loading Pulse dashboard…</p>}
      <div className="platform-client-dashboard-grid">
        <section id="organisation-dashboard" className="card platform-client-dashboard__card platform-client-dashboard__card--wide platform-pulse-section platform-pulse-panel">
          <div className="platform-pulse-section__label">Organisation Dashboard</div>
          <h2 className="platform-client-dashboard__h2 platform-pulse-section__title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Activity size={22} strokeWidth={1.75} aria-hidden />
            Change Readiness Pulse Dashboard
          </h2>
          <div className="platform-pulse-kpi-strip">
            <div className="platform-pulse-kpi">
              <div className="platform-pulse-kpi__label">Total responses</div>
              <div className="platform-pulse-kpi__value">{kpis.completedTotal ?? 0}</div>
              <div className="platform-pulse-kpi__meta">
                of {kpis.invitedTotal ?? 0} invited · {kpis.participationRate ?? 0}%
              </div>
            </div>
            <div className="platform-pulse-kpi">
              <div className="platform-pulse-kpi__label">Employee responses</div>
              <div className="platform-pulse-kpi__value">{kpis.completedEmployees ?? 0}</div>
              <div className="platform-pulse-kpi__meta">
                of {kpis.invitedEmployees ?? 0} invited · {kpis.employeeParticipationRate ?? 0}%
              </div>
            </div>
            <div className="platform-pulse-kpi">
              <div className="platform-pulse-kpi__label">Manager responses</div>
              <div className="platform-pulse-kpi__value">{kpis.completedManagers ?? 0}</div>
              <div className="platform-pulse-kpi__meta">
                of {kpis.invitedManagers ?? 0} invited · {kpis.managerParticipationRate ?? 0}%
              </div>
            </div>
            <div className="platform-pulse-kpi">
              <div className="platform-pulse-kpi__label">Avg adoption score</div>
              <div className="platform-pulse-kpi__value">{formatScore(kpis.adoptionScore)}</div>
              <div className="platform-pulse-kpi__meta">/40 · {deltaLabel(kpis.adoptionDelta)}</div>
            </div>
            <div className="platform-pulse-kpi">
              <div className="platform-pulse-kpi__label">Avg sponsorship score</div>
              <div className="platform-pulse-kpi__value">{formatScore(kpis.sponsorshipScore)}</div>
              <div className="platform-pulse-kpi__meta">/40 · {deltaLabel(kpis.sponsorshipDelta)}</div>
            </div>
          </div>
          <div className="platform-pulse-summary">
            <div>
              <span className="muted" style={{ fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Active session
              </span>
              <p style={{ margin: '0.25rem 0 0', fontWeight: 600 }}>{currentSession?.name || 'None'}</p>
            </div>
            <div>
              <span className="muted" style={{ fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Latest session
              </span>
              <p style={{ margin: '0.25rem 0 0', fontWeight: 600 }}>{newestSession?.name || 'None'}</p>
            </div>
          </div>
        </section>

        <section id="organisation-scores" className="card platform-pulse-section platform-pulse-panel">
          <div className="platform-pulse-section__label">Overview</div>
          <h3 className="platform-client-dashboard__h2">Organisation Scores</h3>
          <div className="platform-pulse-split-scores">
            <div className="platform-pulse-split-scores__cell">
              <div className="platform-pulse-split-scores__label">Adoption Readiness</div>
              <div className="platform-pulse-split-scores__value">{formatScore(kpis.adoptionScore)}</div>
              <div className="platform-pulse-split-scores__meta">/40 points</div>
            </div>
            <div className="platform-pulse-split-scores__cell">
              <div className="platform-pulse-split-scores__label">Sponsorship Credibility</div>
              <div className="platform-pulse-split-scores__value">{formatScore(kpis.sponsorshipScore)}</div>
              <div className="platform-pulse-split-scores__meta">/40 points</div>
            </div>
          </div>
          <div className="platform-pulse-breakdown">
            {(dashboard?.quadrants || []).map((q) => (
              <div key={q.name} className="platform-pulse-breakdown__row">
                <span>{q.name}</span>
                <strong>{q.percent}%</strong>
              </div>
            ))}
            {!dashboard?.quadrants?.length && (
              <div className="platform-pulse-breakdown__row">
                <span>No responses yet</span>
                <strong>0%</strong>
              </div>
            )}
          </div>
        </section>

        <section id="employee-breakdown" className="card platform-pulse-section platform-pulse-panel">
          <div className="platform-pulse-section__label">Overview</div>
          <h3 className="platform-client-dashboard__h2">Employee Breakdown</h3>
          <div className="platform-pulse-role-bars">
            {roleBreakdown.map((row) => (
              <div key={row.label} className="platform-pulse-role-bars__row">
                <span>{row.label}</span>
                <strong>{row.value}</strong>
                <em>{row.trend}%</em>
              </div>
            ))}
          </div>
          {!trendBars.length && <p className="muted">No session history yet.</p>}
          {!!trendBars.length && (
            <div className="platform-pulse-mini-chart">
              {trendBars.map((t) => (
                <div key={t.sessionId} className="platform-pulse-mini-chart__group">
                  <div className="platform-pulse-mini-chart__bars">
                    <div
                      className="platform-pulse-mini-chart__bar platform-pulse-mini-chart__bar--adoption"
                      style={{ height: `${Math.max(6, ((t.adoptionScore || 0) / maxTrendScore) * 64)}px` }}
                      title={`Adoption ${formatScore(t.adoptionScore)}`}
                    />
                    <div
                      className="platform-pulse-mini-chart__bar platform-pulse-mini-chart__bar--sponsorship"
                      style={{ height: `${Math.max(6, ((t.sponsorshipScore || 0) / maxTrendScore) * 64)}px` }}
                      title={`Sponsorship ${formatScore(t.sponsorshipScore)}`}
                    />
                  </div>
                  <span className="platform-pulse-mini-chart__label">
                    {(t.sessionName || '').slice(0, 6) || '—'}
                  </span>
                </div>
              ))}
            </div>
          )}
          <div className="platform-pulse-alerts">
            {(dashboard?.alerts || []).map((alert) => (
              <div key={alert.title} className={`platform-pulse-alert platform-pulse-alert--${alert.level}`}>
                <strong>{alert.title}</strong>
                <p>{alert.body}</p>
              </div>
            ))}
            {!dashboard?.alerts?.length && (
              <div className="platform-pulse-alert platform-pulse-alert--info">
                <strong>No active alerts</strong>
                <p>Alert insights will appear here once enough responses are captured.</p>
              </div>
            )}
          </div>
        </section>

        <section id="team-level-view" className="card platform-pulse-section platform-pulse-panel">
          <div className="platform-pulse-section__label">People</div>
          <h3 className="platform-client-dashboard__h2">Dimension Breakdown</h3>
          {!dashboard?.dimensions?.length && <p className="muted">No dimension data yet.</p>}
          {dashboard?.dimensions?.length > 0 && (
            <div className="table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th scope="col">Dimension</th>
                    <th scope="col">Friction avg</th>
                    <th scope="col">Energy avg</th>
                    <th scope="col">Energy trend</th>
                  </tr>
                </thead>
                <tbody>
                  {dashboard.dimensions.map((d) => (
                    <tr key={d.id}>
                      <td>{d.label}</td>
                      <td>{d.frictionAvg == null ? '—' : d.frictionAvg.toFixed(1)}</td>
                      <td>{d.energyAvg == null ? '—' : d.energyAvg.toFixed(1)}</td>
                      <td>{d.highEnergyPercent}% high</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section id="manager-load-report" className="card platform-pulse-section platform-pulse-panel">
          <div className="platform-pulse-section__label">People</div>
          <h3 className="platform-client-dashboard__h2">Manager Load Report</h3>
          <div className="platform-pulse-breakdown">
            {(dashboard?.managerLoad?.bands || []).map((band) => (
              <div key={band.name} className="platform-pulse-breakdown__row platform-pulse-breakdown__row--load">
                <span>{band.name}</span>
                <div className="platform-pulse-load-row-meta">
                  <small>{band.count} managers</small>
                  <strong>{band.percent}%</strong>
                </div>
              </div>
            ))}
            {!dashboard?.managerLoad?.bands?.length && (
              <div className="platform-pulse-breakdown__row">
                <span>No manager responses yet</span>
                <strong>0%</strong>
              </div>
            )}
          </div>
          <div className="platform-pulse-footnote">
            Adoption delta: {shortDelta(kpis.adoptionDelta)} | Sponsorship delta: {shortDelta(kpis.sponsorshipDelta)}
          </div>
        </section>
      </div>
    </div>
  );
}
