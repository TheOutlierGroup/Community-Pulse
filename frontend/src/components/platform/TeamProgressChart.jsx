import { Fragment, useMemo, useRef, useState } from 'react';
import { buildTeamSeries } from '../../utils/teamProgress.js';

const W = 520;
const H = 280;
const M = { top: 16, right: 104, bottom: 36, left: 40 };
const Y_MIN = 8;
const Y_MAX = 40;
const Y_TICKS = [8, 16, 24, 32, 40];
const DIRECTION_LABEL = { rising: 'Rising', flat: 'Flat', falling: 'Falling', none: 'One checkpoint only' };

function formatChange(change) {
  if (change == null) return 'Not enough checkpoints for a trend';
  const sign = change > 0 ? '+' : change < 0 ? '−' : '';
  return `${sign}${Math.abs(change).toFixed(1)} points per checkpoint`;
}

function Panel({ title, measure, stages, series, threshold, active, setHovered, onPin }) {
  const wrapRef = useRef(null);
  const [tip, setTip] = useState(null);
  const n = Math.max(stages.length, 1);
  const innerW = W - M.left - M.right;
  const innerH = H - M.top - M.bottom;
  const sx = (x) => M.left + (n === 1 ? innerW / 2 : (x / (n - 1)) * innerW);
  const sy = (y) => M.top + ((Y_MAX - Math.min(Y_MAX, Math.max(Y_MIN, y))) / (Y_MAX - Y_MIN)) * innerH;

  function showTip(event, team) {
    setHovered(team.key);
    const box = wrapRef.current?.getBoundingClientRect();
    if (!box) return;
    setTip({
      team,
      left: Math.min(event.clientX - box.left + 12, box.width - 220),
      top: Math.max(event.clientY - box.top - 10, 0),
    });
  }

  function hideTip() {
    setHovered(null);
    setTip(null);
  }

  const ordered = [...series].sort((a, b) => (a.key === active ? 1 : 0) - (b.key === active ? 1 : 0));

  return (
    <figure className="team-progress__panel" ref={wrapRef}>
      <figcaption className="team-progress__panel-title">{title}</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title} by team at each checkpoint, with lines of best fit`}>
        {Y_TICKS.map((t) => (
          <g key={t}>
            <line className="team-progress__grid" x1={M.left} x2={W - M.right} y1={sy(t)} y2={sy(t)} />
            <text className="team-progress__tick" x={M.left - 8} y={sy(t)} dy="0.32em" textAnchor="end">
              {t}
            </text>
          </g>
        ))}
        <line className="team-progress__threshold" x1={M.left} x2={W - M.right} y1={sy(threshold)} y2={sy(threshold)} />
        <text className="team-progress__threshold-label" x={W - M.right + 6} y={sy(threshold)} dy="0.32em">
          {threshold} line
        </text>
        {stages.map((stage, x) => (
          <text key={stage.key} className="team-progress__tick" x={sx(x)} y={H - M.bottom + 20} textAnchor="middle">
            {stage.shortLabel}
          </text>
        ))}

        {ordered.map((team) => {
          const dim = active && active !== team.key;
          const isActive = active === team.key;
          const first = team.points[0];
          const last = team.points[team.points.length - 1];
          return (
            <g
              key={team.key}
              className={`team-progress__team team-progress__team--${team.direction}${dim ? ' is-dim' : ''}${isActive ? ' is-active' : ''}`}
            >
              {team.fit ? (
                <>
                  <line
                    className="team-progress__fit"
                    x1={sx(first.x)}
                    y1={sy(team.fit.at(first.x))}
                    x2={sx(last.x)}
                    y2={sy(team.fit.at(last.x))}
                  />
                  <line
                    className="team-progress__hit"
                    x1={sx(first.x)}
                    y1={sy(team.fit.at(first.x))}
                    x2={sx(last.x)}
                    y2={sy(team.fit.at(last.x))}
                    onMouseMove={(e) => showTip(e, team)}
                    onMouseLeave={hideTip}
                    onClick={() => onPin(team.key)}
                  />
                </>
              ) : null}
              {team.points.map((p) => (
                <g key={`${team.key}-${p.x}`}>
                  <circle className="team-progress__dot" cx={sx(p.x)} cy={sy(p.y)} r="4.5" />
                  <circle
                    className="team-progress__hit"
                    cx={sx(p.x)}
                    cy={sy(p.y)}
                    r="12"
                    onMouseMove={(e) => showTip(e, team)}
                    onMouseLeave={hideTip}
                    onClick={() => onPin(team.key)}
                  />
                </g>
              ))}
              {isActive ? (
                <text className="team-progress__end-label" x={sx(last.x) + 10} y={sy(team.fit ? team.fit.at(last.x) : last.y)} dy="0.32em">
                  {team.label.length > 14 ? `${team.label.slice(0, 13)}…` : team.label}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      {tip ? (
        <div className="team-progress__tip" style={{ left: tip.left, top: tip.top }} role="status">
          <b>{tip.team.label}</b>
          <dl>
            {stages.map((stage, x) => {
              const point = tip.team.points.find((p) => p.x === x);
              return (
                <div key={stage.key}>
                  <dt>{stage.shortLabel}</dt>
                  <dd>{point ? point.y.toFixed(1) : 'withheld'}</dd>
                </div>
              );
            })}
          </dl>
          <span>
            {DIRECTION_LABEL[tip.team.direction]} · {formatChange(tip.team.change)}
          </span>
        </div>
      ) : null}
      <span className="visually-hidden">{measure}</span>
    </figure>
  );
}

/**
 * Team progress across checkpoints: each team's score at every checkpoint
 * (dots) with a straight line of best fit, coloured by direction. Teams
 * below the minimum group size at a checkpoint have no point there.
 */
export default function TeamProgressChart({ stages, threshold = 28, minSampleSize = 5 }) {
  const [hovered, setHovered] = useState(null);
  const [pinned, setPinned] = useState('');
  const [showTable, setShowTable] = useState(false);

  const checkpoints = useMemo(
    () =>
      (stages || [])
        .filter((stage) => stage?.available)
        .map((stage) => ({
          key: stage.key,
          label: stage.label,
          shortLabel: String(stage.label || '').replace(/-Change/i, ''),
          teams: stage.teams || [],
        })),
    [stages]
  );
  const adoption = useMemo(() => buildTeamSeries(checkpoints, 'adoption'), [checkpoints]);
  const sponsorship = useMemo(() => buildTeamSeries(checkpoints, 'sponsorship'), [checkpoints]);
  const teams = useMemo(() => {
    const map = new Map();
    for (const t of [...adoption, ...sponsorship]) map.set(t.key, t.label);
    return [...map.entries()].map(([key, label]) => ({ key, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [adoption, sponsorship]);
  const active = hovered || pinned || null;
  const onPin = (key) => setPinned((current) => (current === key ? '' : key));

  if (checkpoints.length < 2 || teams.length === 0) {
    return (
      <section className="card team-progress">
        <h3 className="team-progress__title">Team progress across checkpoints</h3>
        <p className="muted" style={{ margin: 0 }}>
          Team trends appear once at least two checkpoints have team results. A team is shown at a checkpoint once at
          least {minSampleSize} of its staff have responded.
        </p>
      </section>
    );
  }

  const tableRows = teams.map((team) => ({
    ...team,
    adoption: adoption.find((s) => s.key === team.key) || null,
    sponsorship: sponsorship.find((s) => s.key === team.key) || null,
  }));

  return (
    <section className="card team-progress">
      <div className="team-progress__head">
        <div>
          <h3 className="team-progress__title">Team progress across checkpoints</h3>
          <p className="team-progress__sub">
            Each dot is a team&apos;s score at a checkpoint; the line is its trend (line of best fit).
          </p>
        </div>
        <div className="team-progress__controls">
          <label className="team-progress__select">
            <span>Highlight</span>
            <select value={pinned} onChange={(e) => setPinned(e.target.value)}>
              <option value="">All teams</option>
              {teams.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="btn btn-ghost team-progress__toggle" onClick={() => setShowTable((v) => !v)}>
            {showTable ? 'Show chart' : 'Show table'}
          </button>
        </div>
      </div>
      <ul className="team-progress__legend" aria-label="Trend direction">
        <li><i className="team-progress__swatch team-progress__swatch--rising" aria-hidden="true" />Rising</li>
        <li><i className="team-progress__swatch team-progress__swatch--flat" aria-hidden="true" />Flat (within ±0.5 a checkpoint)</li>
        <li><i className="team-progress__swatch team-progress__swatch--falling" aria-hidden="true" />Falling (dashed)</li>
      </ul>

      {showTable ? (
        <div className="table-wrap">
          <table className="team-progress__table">
            <thead>
              <tr>
                <th rowSpan={2}>Team</th>
                <th colSpan={checkpoints.length + 1}>Adoption readiness</th>
                <th colSpan={checkpoints.length + 1}>Sponsorship credibility</th>
              </tr>
              <tr>
                {[0, 1].map((g) => (
                  <Fragment key={g}>
                    {checkpoints.map((c) => <th key={`${g}-${c.key}`}>{c.shortLabel}</th>)}
                    <th>Trend</th>
                  </Fragment>
                ))}
              </tr>
            </thead>
            <tbody>
              {tableRows.map((row) => (
                <tr key={row.key}>
                  <td>{row.label}</td>
                  {[row.adoption, row.sponsorship].map((s, g) => (
                    <Fragment key={g}>
                      {checkpoints.map((c, x) => {
                        const p = s?.points.find((pt) => pt.x === x);
                        return <td key={`${g}-${c.key}`}>{p ? p.y.toFixed(1) : '--'}</td>;
                      })}
                      <td>{s?.change != null ? `${DIRECTION_LABEL[s.direction]} (${s.change > 0 ? '+' : ''}${s.change.toFixed(1)})` : '--'}</td>
                    </Fragment>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="team-progress__panels">
          <Panel
            title="Adoption readiness"
            measure="adoption"
            stages={checkpoints}
            series={adoption}
            threshold={threshold}
            active={active}
            setHovered={setHovered}
            onPin={onPin}
          />
          <Panel
            title="Sponsorship credibility"
            measure="sponsorship"
            stages={checkpoints}
            series={sponsorship}
            threshold={threshold}
            active={active}
            setHovered={setHovered}
            onPin={onPin}
          />
        </div>
      )}
      <p className="team-progress__note">
        Scores run from 8 to 40; the dashed line is the {threshold}-point threshold. A team appears at a checkpoint once at
        least {minSampleSize} of its staff have responded, so some teams have gaps. &ldquo;--&rdquo; means withheld.
      </p>
    </section>
  );
}
