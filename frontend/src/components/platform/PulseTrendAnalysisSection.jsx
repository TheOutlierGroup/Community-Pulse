import { useMemo } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

function formatScore(value, digits = 1, fallback = '--') {
  if (!Number.isFinite(value)) return fallback;
  return Number(value).toFixed(digits);
}

function formatPercent(value) {
  if (!Number.isFinite(value)) return '--';
  return `${Math.round(value)}%`;
}

function formatDelta(value, minDigits = 1, maxDigits = 3) {
  if (!Number.isFinite(value)) return '--';
  let digits = minDigits;
  // Preserve small non-zero movement that would otherwise round to 0.0.
  while (
    digits < maxDigits
    && value !== 0
    && Number(value.toFixed(digits)) === 0
  ) {
    digits += 1;
  }
  const formatted = value.toFixed(digits);
  if (value > 0) return `+${formatted}`;
  return formatted;
}

function bandTone(value) {
  if (!Number.isFinite(value)) return 'muted';
  if (value >= 4.0) return 'green';
  if (value >= 3.5) return 'green-soft';
  if (value >= 3.0) return 'amber';
  if (value >= 2.5) return 'orange';
  return 'red';
}

function latestAvailableStage(orderedStages) {
  for (let index = orderedStages.length - 1; index >= 0; index -= 1) {
    if (orderedStages[index]?.available) return orderedStages[index];
  }
  return null;
}

function stageDelta(orderedStages, accessor) {
  const available = orderedStages.filter((stage) => stage.available);
  if (available.length < 2) return null;
  const latest = accessor(available[available.length - 1]);
  const previous = accessor(available[available.length - 2]);
  if (!Number.isFinite(latest) || !Number.isFinite(previous)) return null;
  return latest - previous;
}

function strongestDimensionMovement(orderedStages, dimensionIds, accessor) {
  const available = orderedStages.filter((stage) => stage.available);
  if (available.length < 2) return null;
  let best = null;
  for (const id of dimensionIds) {
    for (let idx = 1; idx < available.length; idx += 1) {
      const from = accessor(available[idx - 1], id);
      const to = accessor(available[idx], id);
      if (!Number.isFinite(from) || !Number.isFinite(to)) continue;
      const delta = to - from;
      const absDelta = Math.abs(delta);
      if (!best || absDelta > best.absDelta) {
        best = { id, fromStage: available[idx - 1].label, toStage: available[idx].label, delta, absDelta };
      }
    }
  }
  return best;
}

function chartScore(value) {
  return Number.isFinite(value) ? Number(value.toFixed(2)) : null;
}

const TREND_MEASURE_COPY = {
  section1: `The two primary scores - Adoption Readiness and Sponsorship Credibility - represent the overall health of the change programme from two directions. Adoption Readiness (scored 0-40 from the employee survey) measures whether the organisation has the conditions for people to genuinely adopt the change: capacity, track record, manager enablement, and change load. Sponsorship Credibility (scored 0-40) measures whether leaders are visibly and consistently driving the change: visible sponsorship, walk-the-talk behaviour, honest communication, and psychological safety. A score of 28 or above in either dimension indicates HIGH classification.`,
  section2: `The quadrant is determined by crossing Adoption Readiness (HIGH if >=28, LOW if <28) against Sponsorship Credibility (HIGH if >=28, LOW if <28), producing one of four states: Optimal, Motivated but Lost, Capable but Wary, or High Risk. The Quadrant Journey tracks how this classification changes at each stage, showing whether conditions are moving toward Optimal or away from execution readiness.`,
  section3: `The overall Sponsorship Credibility score is broken into two distinct constructs, each scored 0-20 from the manager survey. Sponsorship Received (MQ9-MQ12) measures whether senior leaders are visibly modelling the change, staying present under pressure, communicating clearly, and speaking with one voice. Sponsorship Capacity (MQ13-MQ16) measures whether managers have the autonomy, support, resilience, and capability to sponsor their teams effectively. Separating these constructs identifies whether the sponsorship deficit originates above the manager layer or within manager support conditions.`,
  section4: `Manager Load is the degree to which managers have genuine bandwidth to take on additional change leadership. It is derived from manager load questions and classifies managers into Sustainable, Stretched, At Capacity, or Overloaded. A shift toward Sustainable indicates recovering capacity; a shift toward Overloaded is a critical signal that the change is depleting the people expected to lead it.`,
  section5: `The employee survey contains eight dimensions across adoption (1A-1D) and sponsorship (2A-2D), scored on a 1.0-5.0 normalised scale. Adoption dimensions capture capability, track record, change load, and manager enablement. Sponsorship dimensions capture visible sponsorship, walk-the-talk behaviour, communication quality, and psychological safety. Tracking these across stages shows which specific readiness conditions are improving or deteriorating.`,
  section6: `Two manager dimensions are surfaced because they are directly tied to manager capacity and sponsorship chain resilience. Change Saturation (1C) measures whether the number and pace of initiatives remain manageable. Manager Wellbeing (2D) measures whether managers feel resilient and supported under sustained change pressure. Decline in either is an early warning that sponsorship capacity is eroding.`,
  section7: `Sponsorship chain state classifies each manager by crossing Received and Capacity against threshold into one of four states: Chain Functioning, Breaking at Manager Level, Resilient Under-Supported, or Sponsorship Failed at Both Levels. Tracking this distribution across stages shows whether sponsorship transmission from senior leaders through managers is strengthening or fracturing.`,
  section8: `Perception gap measures the difference between employee sponsorship experience and manager self-assessment. Employee sponsorship is derived from Q9-Q16 and manager sponsorship from MQ9-MQ16, both normalised to 1.0-5.0. A positive gap (manager above employee) indicates managers are overestimating sponsorship delivery; a narrowing gap across stages indicates sponsorship behaviour is becoming more visible and consistent to employees.`,
  section9: `Cross-stage divergence flags surface any dimension where average score movement is 1.0 points or more on the 1.0-5.0 scale between adjacent stages (Pre->During or During->Post). This threshold captures material cohort-level change in either direction. The section is intended to prevent manual scanning by automatically surfacing the largest shifts. If no dimension meets threshold, a holding state is shown.`,
};

function TrendMeasure({ copy }) {
  return (
    <div className="pulse-trend-card__measure">
      <p className="pulse-trend-card__measure-label">What this measures</p>
      <p className="pulse-trend-card__measure-text">{copy}</p>
    </div>
  );
}

function renderSignalMarkup(text) {
  const source = String(text || '').trim();
  if (!source) return null;
  const parts = [];
  const regex = /<strong>(.*?)<\/strong>/gi;
  let lastIndex = 0;
  let match;
  while ((match = regex.exec(source)) != null) {
    if (match.index > lastIndex) {
      parts.push(source.slice(lastIndex, match.index));
    }
    parts.push(<strong key={`strong-${match.index}`}>{match[1]}</strong>);
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < source.length) {
    parts.push(source.slice(lastIndex));
  }
  return parts.length > 0 ? parts : source;
}

export default function PulseTrendAnalysisSection({
  loading,
  error,
  orderedStages,
  divergenceFlags,
  selectedTimepoint,
  sectionSignals,
}) {
  const stageColumns = useMemo(
    () => orderedStages.map((stage) => stage.label),
    [orderedStages]
  );
  const currentStage = useMemo(() => latestAvailableStage(orderedStages), [orderedStages]);
  const primaryAdoptionDelta = useMemo(
    () => stageDelta(orderedStages, (stage) => stage.adoptionScore),
    [orderedStages]
  );
  const primarySponsorshipDelta = useMemo(
    () => stageDelta(orderedStages, (stage) => stage.sponsorshipScore),
    [orderedStages]
  );
  const receivedDelta = useMemo(
    () => stageDelta(orderedStages, (stage) => stage.receivedAvg),
    [orderedStages]
  );
  const capacityDelta = useMemo(
    () => stageDelta(orderedStages, (stage) => stage.capacityAvg),
    [orderedStages]
  );
  const chainFunctioningDelta = useMemo(
    () => stageDelta(orderedStages, (stage) => stage.chainStates['Chain Functioning']),
    [orderedStages]
  );
  const primaryMovementHeadline = useMemo(() => {
    const hasAdoptionDelta = Number.isFinite(primaryAdoptionDelta);
    const hasSponsorshipDelta = Number.isFinite(primarySponsorshipDelta);
    if (!hasAdoptionDelta && !hasSponsorshipDelta) return 'Primary score movement is not available yet.';
    if (hasAdoptionDelta && !hasSponsorshipDelta) return 'Adoption has movement data; Sponsorship delta is not available yet.';
    if (!hasAdoptionDelta && hasSponsorshipDelta) return 'Sponsorship has movement data; Adoption delta is not available yet.';
    const adoptionAbs = Math.abs(primaryAdoptionDelta);
    const sponsorshipAbs = Math.abs(primarySponsorshipDelta);
    if (adoptionAbs < 0.05 && sponsorshipAbs < 0.05) return 'Both primary scores are currently stable.';
    if (Math.abs(adoptionAbs - sponsorshipAbs) < 0.05) return 'Adoption and Sponsorship moved by similar amounts.';
    return adoptionAbs > sponsorshipAbs ? 'Adoption has moved the most.' : 'Sponsorship has moved the most.';
  }, [primaryAdoptionDelta, primarySponsorshipDelta]);
  const subScoreHeadline = useMemo(() => {
    const received = currentStage?.receivedAvg;
    const capacity = currentStage?.capacityAvg;
    if (!Number.isFinite(received) || !Number.isFinite(capacity)) {
      return 'Current sub-score comparison is not available yet.';
    }
    if (Math.abs(received - capacity) < 0.05) return 'Received and Capacity are currently aligned.';
    return received <= capacity ? 'Received is currently the weaker sub-score.' : 'Capacity is currently the weaker sub-score.';
  }, [currentStage?.capacityAvg, currentStage?.receivedAvg]);
  const overloadHeadline = useMemo(() => {
    const overloaded = currentStage?.loadBands?.Overloaded;
    if (!Number.isFinite(overloaded)) return 'Overloaded-band data is not available yet.';
    if (overloaded >= 10) return `Critical load threshold breached (${formatPercent(overloaded)} overloaded).`;
    return 'Overloaded band remains below critical threshold.';
  }, [currentStage?.loadBands?.Overloaded]);
  const managerConstraintHeadline = useMemo(() => {
    const changeSaturation = currentStage?.dimensions?.manager?.['1C'];
    const managerWellbeing = currentStage?.dimensions?.manager?.['2D'];
    if (!Number.isFinite(changeSaturation) || !Number.isFinite(managerWellbeing)) {
      return 'Manager-capacity constraint signal is not available yet.';
    }
    return changeSaturation < managerWellbeing
      ? 'Change Saturation is the tighter constraint on manager capacity.'
      : 'Manager Wellbeing is the tighter constraint on manager capacity.';
  }, [currentStage?.dimensions?.manager]);
  const perceptionGapHeadline = useMemo(() => {
    const gap = currentStage?.perceptionGap;
    if (!Number.isFinite(gap)) return 'Perception-gap signal is not available yet.';
    return gap > 0
      ? 'Managers are currently overestimating sponsorship delivery versus employee experience.'
      : 'Managers are not overestimating sponsorship delivery at the current stage.';
  }, [currentStage?.perceptionGap]);
  const primarySeriesData = useMemo(
    () => orderedStages.map((stage) => ({
      stage: stage.label,
      adoption: chartScore(stage.adoptionScore),
      sponsorship: chartScore(stage.sponsorshipScore),
    })),
    [orderedStages]
  );
  const subScoreSeriesData = useMemo(
    () => orderedStages.map((stage) => ({
      stage: stage.label,
      received: chartScore(stage.receivedAvg),
      capacity: chartScore(stage.capacityAvg),
    })),
    [orderedStages]
  );
  const loadBandSeriesData = useMemo(
    () => orderedStages.map((stage) => ({
      stage: stage.label,
      Sustainable: chartScore(stage.loadBands.Sustainable),
      Stretched: chartScore(stage.loadBands.Stretched),
      'At Capacity': chartScore(stage.loadBands['At Capacity']),
      Overloaded: chartScore(stage.loadBands.Overloaded),
    })),
    [orderedStages]
  );
  const chainSeriesData = useMemo(
    () => orderedStages.map((stage) => ({
      stage: stage.label,
      'Chain Functioning': chartScore(stage.chainStates['Chain Functioning']),
      'Breaking at Manager Level': chartScore(stage.chainStates['Breaking at Manager Level']),
      'Managers Resilient, Under-Supported': chartScore(stage.chainStates['Managers Resilient, Under-Supported']),
      'Sponsorship Failed at Both Levels': chartScore(stage.chainStates['Sponsorship Failed at Both Levels']),
    })),
    [orderedStages]
  );
  const perceptionGapSeriesData = useMemo(
    () => orderedStages.map((stage) => ({
      stage: stage.label,
      employee: chartScore(stage.employeeSponsorshipAvg),
      manager: chartScore(stage.managerSponsorshipAvg),
      gap: chartScore(stage.perceptionGap),
    })),
    [orderedStages]
  );
  const managerSaturationSeriesData = useMemo(
    () => orderedStages.map((stage) => ({
      stage: stage.label,
      value: chartScore(stage.dimensions?.manager?.['1C']),
    })),
    [orderedStages]
  );
  const managerWellbeingSeriesData = useMemo(
    () => orderedStages.map((stage) => ({
      stage: stage.label,
      value: chartScore(stage.dimensions?.manager?.['2D']),
    })),
    [orderedStages]
  );

  const employeeAdoptionMove = useMemo(
    () =>
      strongestDimensionMovement(
        orderedStages,
        ['1A', '1B', '1C', '1D'],
        (stage, id) => stage.dimensions.employee[id]
      ),
    [orderedStages]
  );
  const employeeSponsorshipMove = useMemo(
    () =>
      strongestDimensionMovement(
        orderedStages,
        ['2A', '2B', '2C', '2D'],
        (stage, id) => stage.dimensions.employee[id]
      ),
    [orderedStages]
  );
  const section1Signal = sectionSignals?.section1;
  const section2Signal = sectionSignals?.section2;
  const section3Signal = sectionSignals?.section3;
  const section4Signal = sectionSignals?.section4;
  const section5Signal = sectionSignals?.section5;
  const section6Signal = sectionSignals?.section6;
  const section7Signal = sectionSignals?.section7;
  const section8Signal = sectionSignals?.section8;
  const section9Signal = sectionSignals?.section9;
  const quadrantJourneySummary = useMemo(() => {
    const withNames = orderedStages
      .map((stage) => ({ label: stage.label, quadrant: String(stage.quadrant || '').trim() || '--' }))
      .filter((stage) => stage.quadrant !== '--');
    if (withNames.length === 0) return 'Quadrant journey is not available yet.';
    const sequence = withNames.map((stage) => `${stage.label}: ${stage.quadrant}`).join(' -> ');
    return `Quadrant journey: ${sequence}.`;
  }, [orderedStages]);

  if (loading) {
    return (
      <section className="card pulse-trend-section">
        <p className="muted" style={{ marginBottom: 0 }}>Loading trend analysis...</p>
      </section>
    );
  }

  if (error) {
    return (
      <section className="card pulse-trend-section">
        <p className="error" style={{ marginBottom: 0 }}>{error}</p>
      </section>
    );
  }

  if (!orderedStages.length) {
    if (selectedTimepoint === 'pre') {
      return (
        <section className="card pulse-trend-section">
          <p className="muted" style={{ marginBottom: 0 }}>
            Trend data becomes available once the During-Change assessment has been completed.
          </p>
        </section>
      );
    }
    return (
      <section className="card pulse-trend-section">
        <p className="muted" style={{ marginBottom: 0 }}>No trend analysis data is available yet.</p>
      </section>
    );
  }

  return (
    <section className="pulse-trend">
      <article className="card pulse-trend-card">
        <p className="pulse-trend-card__label">Section 1 - Primary Score Movement</p>
        <TrendMeasure copy={TREND_MEASURE_COPY.section1} />
        <div className="pulse-trend-card__chart">
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={primarySeriesData} margin={{ top: 8, right: 12, left: 0, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" />
              <XAxis dataKey="stage" tick={{ fill: '#71717a', fontSize: 11 }} />
              <YAxis domain={[0, 40]} tick={{ fill: '#71717a', fontSize: 11 }} />
              <Tooltip formatter={(value) => formatScore(value, 1)} />
              <ReferenceLine y={28} stroke="#8a95a8" strokeDasharray="4 4" />
              <Line type="monotone" dataKey="adoption" name="Adoption Readiness" stroke="#4a90d9" strokeWidth={2} dot />
              <Line type="monotone" dataKey="sponsorship" name="Sponsorship Credibility" stroke="#c47a4a" strokeWidth={2} dot />
              <Legend wrapperStyle={{ fontSize: 12 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <p className="pulse-trend-card__signal">
          {section1Signal
            ? renderSignalMarkup(section1Signal)
            : (
              <>
                <strong>{primaryMovementHeadline}</strong>{' '}
                Latest deltas are Adoption {formatDelta(primaryAdoptionDelta)} and Sponsorship {formatDelta(primarySponsorshipDelta)}.
              </>
            )}
        </p>
      </article>

      <article className="card pulse-trend-card">
        <p className="pulse-trend-card__label">Section 2 - Quadrant Journey</p>
        <TrendMeasure copy={TREND_MEASURE_COPY.section2} />
        <div className="pulse-trend-flow">
          {orderedStages.map((stage, idx) => (
            <div key={`quad-${stage.key}`} className="pulse-trend-flow__node">
              <p className="pulse-trend-flow__stage">{stage.label}</p>
              <p className="pulse-trend-flow__quadrant">{stage.quadrant || '--'}</p>
              {idx < orderedStages.length - 1 ? <span className="pulse-trend-flow__arrow">→</span> : null}
            </div>
          ))}
        </div>
        <p className="pulse-trend-card__subnote">{quadrantJourneySummary}</p>
        <p className="pulse-trend-card__signal">
          {section2Signal
            ? renderSignalMarkup(section2Signal)
            : <><strong>Current quadrant is {currentStage?.quadrant || '--'}.</strong> Use this trajectory to set leadership intervention priority.</>}
        </p>
      </article>

      <article className="card pulse-trend-card">
        <p className="pulse-trend-card__label">Section 3 - Sponsorship Sub-Score Trend</p>
        <TrendMeasure copy={TREND_MEASURE_COPY.section3} />
        <div className="pulse-trend-card__chart">
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={subScoreSeriesData} margin={{ top: 8, right: 12, left: 0, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" />
              <XAxis dataKey="stage" tick={{ fill: '#71717a', fontSize: 11 }} />
              <YAxis domain={[0, 20]} tick={{ fill: '#71717a', fontSize: 11 }} />
              <Tooltip formatter={(value) => formatScore(value, 1)} />
              <ReferenceLine y={14} stroke="#8a95a8" strokeDasharray="4 4" />
              <Line type="monotone" dataKey="received" name="Received" stroke="#4a90d9" strokeWidth={2} dot />
              <Line type="monotone" dataKey="capacity" name="Capacity" stroke="#c47a4a" strokeWidth={2} dot />
              <Legend wrapperStyle={{ fontSize: 12 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <p className="pulse-trend-card__signal">
          {section3Signal
            ? renderSignalMarkup(section3Signal)
            : (
              <>
                <strong>{subScoreHeadline}</strong>{' '}
                Latest deltas: Received {formatDelta(receivedDelta)}, Capacity {formatDelta(capacityDelta)}.
              </>
            )}
        </p>
      </article>

      <article className="card pulse-trend-card">
        <p className="pulse-trend-card__label">Section 4 - Manager Load Band Shift</p>
        <TrendMeasure copy={TREND_MEASURE_COPY.section4} />
        <div className="pulse-trend-card__chart">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={loadBandSeriesData} margin={{ top: 8, right: 12, left: 0, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" />
              <XAxis dataKey="stage" tick={{ fill: '#71717a', fontSize: 11 }} />
              <YAxis domain={[0, 100]} tick={{ fill: '#71717a', fontSize: 11 }} />
              <Tooltip formatter={(value) => `${Math.round(value || 0)}%`} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="Sustainable" stackId="load" fill="#1e855d" />
              <Bar dataKey="Stretched" stackId="load" fill="#f5a623" />
              <Bar dataKey="At Capacity" stackId="load" fill="#cc4e0f" />
              <Bar dataKey="Overloaded" stackId="load" fill="#e52235" />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <p className="pulse-trend-card__signal">
          {section4Signal
            ? renderSignalMarkup(section4Signal)
            : (
              <>
                <strong>{overloadHeadline}</strong>{' '}
                Adjust pace and support based on this distribution.
              </>
            )}
        </p>
      </article>

      <article className="card pulse-trend-card">
        <p className="pulse-trend-card__label">Section 5 - Dimension Trend: Employee Survey</p>
        <TrendMeasure copy={TREND_MEASURE_COPY.section5} />
        <div className="table-wrap">
          <table className="pulse-trend-table">
            <thead>
              <tr>
                <th>Dimension</th>
                {stageColumns.map((label) => <th key={`emp-head-${label}`}>{label}</th>)}
              </tr>
            </thead>
            <tbody>
              {['1A', '1B', '1C', '1D', '2A', '2B', '2C', '2D'].map((id) => (
                <tr key={`emp-${id}`}>
                  <td>{id}</td>
                  {orderedStages.map((stage) => (
                    <td key={`emp-${id}-${stage.key}`}>
                      <span className={`pulse-trend-chip pulse-trend-chip--${bandTone(stage.dimensions.employee[id])}`}>
                        {formatScore(stage.dimensions.employee[id])}
                      </span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="pulse-trend-card__signal">
          {section5Signal
            ? renderSignalMarkup(section5Signal)
            : (
              <>
                <strong>
                  {employeeAdoptionMove
                    ? `${employeeAdoptionMove.id} shows the largest adoption-side movement (${formatDelta(employeeAdoptionMove.delta)}).`
                    : 'No adoption-side movement available yet.'}
                </strong>{' '}
                {employeeSponsorshipMove
                  ? `${employeeSponsorshipMove.id} shows the largest sponsorship-side movement (${formatDelta(employeeSponsorshipMove.delta)}).`
                  : ''}
              </>
            )}
        </p>
      </article>

      <article className="card pulse-trend-card">
        <p className="pulse-trend-card__label">Section 6 - Manager Dimension Trend (Selected)</p>
        <TrendMeasure copy={TREND_MEASURE_COPY.section6} />
        <div className="pulse-trend-panels">
          <div className="pulse-trend-panel">
            <p className="pulse-trend-panel__title">1C Change Saturation</p>
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={managerSaturationSeriesData} margin={{ top: 8, right: 12, left: 0, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" />
                <XAxis dataKey="stage" tick={{ fill: '#71717a', fontSize: 11 }} />
                <YAxis domain={[1, 5]} tick={{ fill: '#71717a', fontSize: 11 }} />
                <Tooltip formatter={(value) => formatScore(value, 1)} />
                <Line type="monotone" dataKey="value" name="1C avg" stroke="#4a90d9" strokeWidth={2} dot />
              </LineChart>
            </ResponsiveContainer>
            <p className="pulse-trend-panel__note">MQ5 + MQ6 contribute to Manager Load score.</p>
          </div>
          <div className="pulse-trend-panel">
            <p className="pulse-trend-panel__title">2D Manager Wellbeing</p>
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={managerWellbeingSeriesData} margin={{ top: 8, right: 12, left: 0, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" />
                <XAxis dataKey="stage" tick={{ fill: '#71717a', fontSize: 11 }} />
                <YAxis domain={[1, 5]} tick={{ fill: '#71717a', fontSize: 11 }} />
                <Tooltip formatter={(value) => formatScore(value, 1)} />
                <Line type="monotone" dataKey="value" name="2D avg" stroke="#c47a4a" strokeWidth={2} dot />
              </LineChart>
            </ResponsiveContainer>
            <p className="pulse-trend-panel__note">MQ15 + MQ16 contribute to Manager Load score.</p>
          </div>
        </div>
        <p className="pulse-trend-card__signal">
          {section6Signal
            ? renderSignalMarkup(section6Signal)
            : (
              <>
                <strong>{managerConstraintHeadline}</strong>{' '}
                Use this as an early warning for sponsorship chain strain.
              </>
            )}
        </p>
      </article>

      <article className="card pulse-trend-card">
        <p className="pulse-trend-card__label">Section 7 - Sponsorship Chain State Shift</p>
        <TrendMeasure copy={TREND_MEASURE_COPY.section7} />
        <div className="pulse-trend-card__chart">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={chainSeriesData} margin={{ top: 8, right: 12, left: 0, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" />
              <XAxis dataKey="stage" tick={{ fill: '#71717a', fontSize: 11 }} />
              <YAxis domain={[0, 100]} tick={{ fill: '#71717a', fontSize: 11 }} />
              <Tooltip formatter={(value) => `${Math.round(value || 0)}%`} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="Chain Functioning" stackId="chain" fill="#1e855d" />
              <Bar dataKey="Breaking at Manager Level" stackId="chain" fill="#f5a623" />
              <Bar dataKey="Managers Resilient, Under-Supported" stackId="chain" fill="#cc4e0f" />
              <Bar dataKey="Sponsorship Failed at Both Levels" stackId="chain" fill="#e52235" />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <p className="pulse-trend-card__signal">
          {section7Signal
            ? renderSignalMarkup(section7Signal)
            : (
              <>
                <strong>Chain Functioning is {formatPercent(currentStage?.chainStates['Chain Functioning'])} at the current stage.</strong>{' '}
                Delta vs prior stage: {formatDelta(chainFunctioningDelta)}pp.
              </>
            )}
        </p>
      </article>

      <article className="card pulse-trend-card">
        <p className="pulse-trend-card__label">Section 8 - Perception Gap Trend</p>
        <TrendMeasure copy={TREND_MEASURE_COPY.section8} />
        <div className="pulse-trend-card__chart">
          <ResponsiveContainer width="100%" height={220}>
            <ComposedChart data={perceptionGapSeriesData} margin={{ top: 8, right: 12, left: 0, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" />
              <XAxis dataKey="stage" tick={{ fill: '#71717a', fontSize: 11 }} />
              <YAxis domain={[1, 5]} tick={{ fill: '#71717a', fontSize: 11 }} />
              <Tooltip formatter={(value) => formatScore(value, 1)} />
              <Line type="monotone" dataKey="employee" name="Employee sponsorship avg" stroke="#4a90d9" strokeWidth={2} dot />
              <Line type="monotone" dataKey="manager" name="Manager sponsorship avg" stroke="#c47a4a" strokeWidth={2} dot />
              <Legend wrapperStyle={{ fontSize: 12 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <p className="pulse-trend-card__signal">
          {section8Signal
            ? renderSignalMarkup(section8Signal)
            : (
              <>
                <strong>{perceptionGapHeadline}</strong>{' '}
                Track whether the gap narrows or widens in the next wave.
              </>
            )}
        </p>
      </article>

      <article className="card pulse-trend-card">
        <p className="pulse-trend-card__label">Section 9 - Cross-Stage Divergence Flags</p>
        <TrendMeasure copy={TREND_MEASURE_COPY.section9} />
        {divergenceFlags.length > 0 ? (
          <div className="table-wrap">
            <table className="pulse-trend-table">
              <thead>
                <tr>
                  <th>Dimension</th>
                  <th>Survey</th>
                  <th>Transition</th>
                  <th>From</th>
                  <th>To</th>
                  <th>Delta</th>
                  <th>Direction</th>
                </tr>
              </thead>
              <tbody>
                {divergenceFlags.map((flag) => (
                  <tr key={flag.key}>
                    <td>{flag.dimensionId}</td>
                    <td>{flag.survey}</td>
                    <td>{flag.transition}</td>
                    <td>{formatScore(flag.from)}</td>
                    <td>{formatScore(flag.to)}</td>
                    <td>{formatDelta(flag.delta)}</td>
                    <td>{flag.delta > 0 ? '↑ Improved' : '↓ Declined'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted" style={{ marginBottom: 0, fontStyle: 'italic' }}>
            No cross-stage divergence flags at this stage. Score movements across all dimensions are within expected variation (±1.0 point).
          </p>
        )}
        {divergenceFlags.length > 0 ? (
          <p className="pulse-trend-card__signal">
            {section9Signal
              ? renderSignalMarkup(section9Signal)
              : (
                <>
                  <strong>
                    {divergenceFlags[0].delta > 0 ? 'Largest flagged movement is an improvement.' : 'Largest flagged movement is a decline.'}
                  </strong>{' '}
                  Prioritise intervention around {divergenceFlags[0].dimensionId} ({divergenceFlags[0].transition}).
                </>
              )}
          </p>
        ) : null}
      </article>
    </section>
  );
}
