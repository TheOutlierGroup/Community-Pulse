import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useOutletContext } from 'react-router-dom';
import api from '../services/api.js';
import { normalizeServices } from './platformClientUtils.js';

const PULSE_SECTION_IDS = [
  'organisation-dashboard',
  'organisation-scores',
  'manager-load-report',
  'employee-breakdown',
  'score-breakdown',
  'team-level-view',
];

function formatScore(value) {
  if (value == null || Number.isNaN(value)) return '—';
  return value.toFixed(1);
}

function formatPercent(value) {
  if (value == null || Number.isNaN(value)) return '0%';
  return `${Math.round(value)}%`;
}

function deltaText(value) {
  if (value == null || Number.isNaN(value)) return 'No prior';
  if (value > 0) return `+${value.toFixed(1)}`;
  if (value < 0) return `${value.toFixed(1)}`;
  return '0.0';
}

function deltaClass(value) {
  if (value == null || Number.isNaN(value) || value === 0) return 'flat';
  return value > 0 ? 'up' : 'dn';
}

function heatClass(value) {
  if (value == null || Number.isNaN(value)) return 'h1';
  if (value >= 4.2) return 'h5';
  if (value >= 3.4) return 'h4';
  if (value >= 2.8) return 'h3';
  if (value >= 2.4) return 'h2';
  return 'h1';
}

function labelToId(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const QUADRANT_ORDER = [
  'Motivated but Lost',
  'Optimal',
  'High Risk',
  'Capable but Wary',
];

const ADOPTION_DIMENSIONS = ['alignment', 'ownership', 'collaboration', 'pace'];

const MANAGER_LOAD_NOTES = {
  Sustainable: 'Manager has capacity. Ready to lead change actively.',
  Stretched: 'At risk if change is significant. Prioritise toolkit support.',
  'At Capacity': 'Requires active manager investment and executive air cover.',
  Overloaded: 'Risk of burnout. Do not launch without addressing load first.',
};

const TEAM_SAMPLE_ROWS = [
  {
    id: 'finance-operations',
    team: 'Finance Operations',
    responses: 24,
    adoption: 35.1,
    sponsorship: 31.4,
    load: 'Sustainable',
    quadrant: 'Optimal',
    trend: [31, 33, 34, 35],
  },
  {
    id: 'customer-experience',
    team: 'Customer Experience',
    responses: 38,
    adoption: 30.8,
    sponsorship: 24.1,
    load: 'Stretched',
    quadrant: 'Capable but Wary',
    trend: [28, 29, 31, 31],
  },
  {
    id: 'technology-data',
    team: 'Technology & Data',
    responses: 29,
    adoption: 27.3,
    sponsorship: 30.1,
    load: 'Stretched',
    quadrant: 'Motivated but Lost',
    trend: [29, 28, 27, 27],
  },
  {
    id: 'risk-compliance',
    team: 'Risk & Compliance',
    responses: 16,
    adoption: 24.4,
    sponsorship: 22.7,
    load: 'Overloaded',
    quadrant: 'High Risk',
    trend: [27, 25, 24, 24],
  },
  {
    id: 'marketing-growth',
    team: 'Marketing & Growth',
    responses: 21,
    adoption: 32.2,
    sponsorship: 28.9,
    load: 'Stretched',
    quadrant: 'Optimal',
    trend: [30, 31, 32, 32],
  },
  {
    id: 'people-culture',
    team: 'People & Culture',
    responses: 18,
    adoption: 28.6,
    sponsorship: 21.3,
    load: 'At Capacity',
    quadrant: 'Capable but Wary',
    trend: [30, 29, 29, 29],
  },
];

function sparkColor(load) {
  if (load === 'Sustainable') return 'var(--pulse-green)';
  if (load === 'Overloaded') return 'var(--pulse-red)';
  if (load === 'At Capacity') return 'var(--pulse-orange)';
  return 'var(--pulse-amber)';
}

function quadrantPillClass(name) {
  if (name === 'Optimal') return 'opt';
  if (name === 'Capable but Wary') return 'cw';
  if (name === 'Motivated but Lost') return 'ml';
  return 'hr';
}

export default function PlatformClientPulse() {
  const { org, orgId } = useOutletContext();
  const navigate = useNavigate();
  const location = useLocation();
  const [dashboard, setDashboard] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('employee');

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
    const targetId = fromHash === 'score-breakdown' ? 'employee-breakdown' : fromHash;
    const el = document.getElementById(targetId);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [location.hash]);

  const kpis = dashboard?.kpis || {};
  const trendBars = useMemo(
    () => [...(dashboard?.trend || []).slice(0, 4)].reverse(),
    [dashboard?.trend]
  );
  const quadrants = useMemo(() => {
    const source = dashboard?.quadrants || [];
    return QUADRANT_ORDER.map((name) => source.find((q) => q.name === name) || { name, percent: 0 });
  }, [dashboard?.quadrants]);
  const dimensions = dashboard?.dimensions || [];
  const managerBands = useMemo(() => {
    const source = dashboard?.managerLoad?.bands || [];
    return ['Sustainable', 'Stretched', 'At Capacity', 'Overloaded'].map(
      (name) => source.find((b) => b.name === name) || { name, percent: 0, count: 0 }
    );
  }, [dashboard?.managerLoad?.bands]);

  const threshold = 28;
  const adoptionScore = kpis.adoptionScore ?? null;
  const sponsorshipScore = kpis.sponsorshipScore ?? null;
  const quadrantFocus =
    quadrants.reduce((top, item) => (item.percent > top.percent ? item : top), quadrants[0] || { name: '—', percent: 0 }) || {
      name: '—',
      percent: 0,
    };

  const todayLabel = new Date().toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  const trendMax = Math.max(
    40,
    ...trendBars.flatMap((item) => [item?.adoptionScore || 0, item?.sponsorshipScore || 0])
  );

  const employeeDimensionRows = dimensions.map((d) => ({
    id: d.id,
    label: d.label,
    family: ADOPTION_DIMENSIONS.includes(d.id) ? 'a' : 's',
    avg: d.energyAvg,
    highPercent: d.highEnergyPercent,
  }));
  const managerDimensionRows = dimensions.map((d) => ({
    id: d.id,
    label: d.label,
    family: ADOPTION_DIMENSIONS.includes(d.id) ? 'a' : 's',
    avg: d.frictionAvg,
    highPercent: d.highEnergyPercent,
  }));
  const activeDimensions = activeTab === 'employee' ? employeeDimensionRows : managerDimensionRows;

  return (
    <div className="pulse-prototype-page">
      <div className="pulse-platform-header">
        <div>
          <div className="pulse-platform-header__eyebrow">Client administration</div>
          <h1 className="pulse-platform-header__title">Organisation Dashboard</h1>
        </div>
        <div className="pulse-platform-header__right">
          <span className="pulse-platform-header__date">{todayLabel}</span>
          <button type="button" className="btn btn-ghost" onClick={loadDashboard} disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      {error && <p className="error">{error}</p>}
      {!error && loading && <p className="muted">Loading Pulse dashboard…</p>}

      <div className="pulse-prototype-content">

          <div className="pulse-prototype-kpis" id="organisation-dashboard">
            <div className="pulse-prototype-kpi">
              <div className="pulse-prototype-kpi__label">Total Responses</div>
              <div className="pulse-prototype-kpi__value neutral">{kpis.completedTotal ?? 0}</div>
              <div className="pulse-prototype-kpi__meta">of {kpis.invitedTotal ?? 0} invited</div>
              <div className={`pulse-prototype-kpi__delta ${deltaClass(kpis.participationRate)}`}>
                {formatPercent(kpis.participationRate)}
              </div>
              <div className="pulse-prototype-kpi__bar" />
            </div>
            <div className="pulse-prototype-kpi">
              <div className="pulse-prototype-kpi__label">Employee Responses</div>
              <div className="pulse-prototype-kpi__value neutral">{kpis.completedEmployees ?? 0}</div>
              <div className="pulse-prototype-kpi__meta">
                of {kpis.invitedEmployees ?? 0} · {formatPercent(kpis.employeeParticipationRate)}
              </div>
              <div className="pulse-prototype-kpi__bar adoption" />
            </div>
            <div className="pulse-prototype-kpi">
              <div className="pulse-prototype-kpi__label">Manager Responses</div>
              <div className="pulse-prototype-kpi__value neutral">{kpis.completedManagers ?? 0}</div>
              <div className="pulse-prototype-kpi__meta">
                of {kpis.invitedManagers ?? 0} · {formatPercent(kpis.managerParticipationRate)}
              </div>
              <div className="pulse-prototype-kpi__bar sponsorship" />
            </div>
            <div className="pulse-prototype-kpi">
              <div className="pulse-prototype-kpi__label">Avg Adoption Score</div>
              <div className="pulse-prototype-kpi__value adoption">{formatScore(adoptionScore)}</div>
              <div className="pulse-prototype-kpi__meta">/40 · Threshold: {threshold}</div>
              <div className={`pulse-prototype-kpi__delta ${deltaClass(kpis.adoptionDelta)}`}>
                {deltaText(kpis.adoptionDelta)}
              </div>
              <div className="pulse-prototype-kpi__bar adoption" />
            </div>
            <div className="pulse-prototype-kpi">
              <div className="pulse-prototype-kpi__label">Avg Sponsorship Score</div>
              <div className="pulse-prototype-kpi__value sponsorship">{formatScore(sponsorshipScore)}</div>
              <div className="pulse-prototype-kpi__meta">
                /40 · {sponsorshipScore != null && sponsorshipScore >= threshold ? 'At threshold' : 'Below threshold'}
              </div>
              <div className={`pulse-prototype-kpi__delta ${deltaClass(kpis.sponsorshipDelta)}`}>
                {deltaText(kpis.sponsorshipDelta)}
              </div>
              <div className="pulse-prototype-kpi__bar sponsorship" />
            </div>
          </div>

          <div className="pulse-prototype-grid pulse-prototype-grid--scores" id="organisation-scores">
            <section className="pulse-prototype-card">
              <div className="pulse-prototype-card__label">Organisation Scores · All Respondents</div>
              <div className="pulse-prototype-score-split">
                <div>
                  <div className="pulse-prototype-score-tag adoption">Adoption Readiness</div>
                  <div className="pulse-prototype-score-value adoption">{formatScore(adoptionScore)}</div>
                  <div className="pulse-prototype-score-denom">/40 points</div>
                  <div className="pulse-prototype-track">
                    <div
                      className="pulse-prototype-fill adoption"
                      style={{ width: `${Math.max(0, Math.min(((adoptionScore || 0) / 40) * 100, 100))}%` }}
                    />
                  </div>
                  <span className={`pulse-prototype-pill ${adoptionScore != null && adoptionScore >= threshold ? 'high' : 'low'}`}>
                    {adoptionScore != null && adoptionScore >= threshold ? 'Above Threshold' : 'Below Threshold'}
                  </span>
                </div>
                <div className="pulse-prototype-divider" />
                <div>
                  <div className="pulse-prototype-score-tag sponsorship">Sponsorship Credibility</div>
                  <div className="pulse-prototype-score-value sponsorship">{formatScore(sponsorshipScore)}</div>
                  <div className="pulse-prototype-score-denom">/40 points</div>
                  <div className="pulse-prototype-track">
                    <div
                      className="pulse-prototype-fill sponsorship"
                      style={{ width: `${Math.max(0, Math.min(((sponsorshipScore || 0) / 40) * 100, 100))}%` }}
                    />
                  </div>
                  <span
                    className={`pulse-prototype-pill ${
                      sponsorshipScore != null && sponsorshipScore >= threshold ? 'high' : 'low'
                    }`}
                  >
                    {sponsorshipScore != null && sponsorshipScore >= threshold ? 'Above Threshold' : 'Below Threshold'}
                  </span>
                </div>
              </div>
              <div className="pulse-prototype-note">
                <div className="pulse-prototype-note__title">Org Quadrant · {quadrantFocus.name}</div>
                <p>
                  {dashboard?.narrative ||
                    'Leadership is trusted and visible, but adoption conditions remain weak. Build capacity before launch.'}
                </p>
              </div>
            </section>

            <section className="pulse-prototype-card">
              <div className="pulse-prototype-card__label">Readiness Distribution · % of respondents</div>
              <div className="pulse-prototype-quadrants">
                {quadrants.map((q) => (
                  <div
                    key={q.name}
                    className={`pulse-prototype-quadrant ${quadrantPillClass(q.name)}`}
                    id={`quad-${labelToId(q.name)}`}
                  >
                    <div className="pulse-prototype-quadrant__pct">{formatPercent(q.percent)}</div>
                    <div className="pulse-prototype-quadrant__name">{q.name}</div>
                  </div>
                ))}
              </div>
              <div className="pulse-prototype-axis">
                <span>&larr; Low Sponsorship</span>
                <span>High Sponsorship &rarr;</span>
              </div>
              <div className="pulse-prototype-axis-up">↑ High Adoption</div>
            </section>
          </div>

          <section className="pulse-prototype-card" id="manager-load-report">
            <div className="pulse-prototype-card__label accent">Manager Load Report · {dashboard?.managerLoad?.total ?? 0} manager respondents</div>
            <div className="pulse-prototype-load-bar">
              {managerBands.map((band) => (
                <div
                  key={band.name}
                  className={`pulse-prototype-load-segment ${labelToId(band.name)}`}
                  style={{ flex: Math.max(band.percent || 0, 1) }}
                  title={`${band.name}: ${formatPercent(band.percent)}`}
                />
              ))}
            </div>
            <div className="pulse-prototype-load-grid">
              {managerBands.map((band) => (
                <div key={band.name} className={`pulse-prototype-load-cell ${labelToId(band.name)}`}>
                  <div className="pulse-prototype-load-cell__pct">{formatPercent(band.percent)}</div>
                  <div className="pulse-prototype-load-cell__name">{band.name}</div>
                  <div className="pulse-prototype-load-cell__desc">{MANAGER_LOAD_NOTES[band.name]}</div>
                </div>
              ))}
            </div>
          </section>

          <div className="pulse-prototype-grid pulse-prototype-grid--analysis" id="employee-breakdown">
            <section className="pulse-prototype-card">
              <div className="pulse-prototype-tabs">
                <button
                  type="button"
                  className={`pulse-prototype-tab ${activeTab === 'employee' ? 'active' : ''}`}
                  onClick={() => setActiveTab('employee')}
                >
                  Employee Dimensions
                </button>
                <button
                  type="button"
                  className={`pulse-prototype-tab ${activeTab === 'manager' ? 'active' : ''}`}
                  onClick={() => setActiveTab('manager')}
                >
                  Manager Dimensions
                </button>
              </div>
              <table className="pulse-prototype-dtable">
                <thead>
                  <tr>
                    <th>Dimension</th>
                    <th>Avg (1-5)</th>
                    <th>% High</th>
                  </tr>
                </thead>
                <tbody>
                  {activeDimensions.map((d) => (
                    <tr key={`${activeTab}-${d.id}`}>
                      <td>
                        <span className="pulse-prototype-dname">{d.label}</span>
                        <span className={`pulse-prototype-dtag ${d.family}`}>
                          {d.family === 'a' ? 'Adoption' : 'Sponsorship'}
                        </span>
                      </td>
                      <td>
                        <span className={`pulse-prototype-heat ${heatClass(d.avg)}`}>{formatScore(d.avg)}</span>
                      </td>
                      <td className="pulse-prototype-dpct">{formatPercent(d.highPercent)}</td>
                    </tr>
                  ))}
                  {!activeDimensions.length && (
                    <tr>
                      <td colSpan={3} className="pulse-prototype-empty">
                        No dimension data yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </section>

            <div className="pulse-prototype-side-stack">
              <section className="pulse-prototype-card">
                <div className="pulse-prototype-card__label">Score Trend · Rolling 4 Waves</div>
                <div className="pulse-prototype-trend-chart">
                  <div className="pulse-prototype-trend-threshold">
                    <span>{threshold} (threshold)</span>
                  </div>
                  {trendBars.map((item, idx) => {
                    const adoptionHeight = Math.max(6, ((item?.adoptionScore || 0) / trendMax) * 100);
                    const sponsorshipHeight = Math.max(6, ((item?.sponsorshipScore || 0) / trendMax) * 100);
                    return (
                      <div key={item.sessionId || `${item.sessionName}-${idx}`} className="pulse-prototype-trend-group">
                        <div className="pulse-prototype-trend-bars">
                          <div className="pulse-prototype-trend-bar adoption" style={{ height: `${adoptionHeight}%` }} />
                          <div className="pulse-prototype-trend-bar sponsorship" style={{ height: `${sponsorshipHeight}%` }} />
                        </div>
                        <div className="pulse-prototype-trend-label">W{idx + 1}</div>
                      </div>
                    );
                  })}
                </div>
                <div className="pulse-prototype-legend">
                  <div className="pulse-prototype-legend-item">
                    <span className="pulse-prototype-legend-dot adoption" />
                    Adoption
                  </div>
                  <div className="pulse-prototype-legend-item">
                    <span className="pulse-prototype-legend-dot sponsorship" />
                    Sponsorship
                  </div>
                </div>
              </section>

              <section className="pulse-prototype-card">
                <div className="pulse-prototype-card__label">System Alerts</div>
                <div className="pulse-prototype-alerts">
                  {(dashboard?.alerts || []).map((alert) => (
                    <div key={alert.title} className={`pulse-prototype-alert ${alert.level || 'info'}`}>
                      <div className="pulse-prototype-alert-title">{alert.title}</div>
                      <div className="pulse-prototype-alert-body">{alert.body}</div>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          </div>

          <section className="pulse-prototype-card" id="team-level-view">
            <div className="pulse-prototype-card__label">Team-Level Breakdown · Showing 6 of 18 teams</div>
            <table className="pulse-prototype-rtable">
              <thead>
                <tr>
                  <th>Team / Function</th>
                  <th>Responses</th>
                  <th>Adoption</th>
                  <th>Sponsorship</th>
                  <th>Manager Load</th>
                  <th>Quadrant</th>
                  <th>4-Wk Trend</th>
                </tr>
              </thead>
              <tbody>
                {TEAM_SAMPLE_ROWS.map((row) => (
                  <tr key={row.id}>
                    <td>{row.team}</td>
                    <td className="pulse-prototype-mono">{row.responses}</td>
                    <td>
                      <span className={`pulse-prototype-heat ${heatClass(row.adoption / 8)}`}>{row.adoption.toFixed(1)}</span>
                    </td>
                    <td>
                      <span className={`pulse-prototype-heat ${heatClass(row.sponsorship / 8)}`}>{row.sponsorship.toFixed(1)}</span>
                    </td>
                    <td className={`pulse-prototype-mono pulse-prototype-load-${labelToId(row.load)}`}>{row.load}</td>
                    <td>
                      <span className={`pulse-prototype-qpill ${quadrantPillClass(row.quadrant)}`}>{row.quadrant}</span>
                    </td>
                    <td>
                      <div className="pulse-prototype-spark">
                        {row.trend.map((value, idx) => (
                          <span
                            key={`${row.id}-spark-${idx}`}
                            style={{
                              height: `${Math.max(3, (value / 35) * 18)}px`,
                              backgroundColor: sparkColor(row.load),
                            }}
                          />
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
      </div>
    </div>
  );
}
