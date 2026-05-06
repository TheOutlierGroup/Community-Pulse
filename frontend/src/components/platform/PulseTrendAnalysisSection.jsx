import { useMemo } from 'react';

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

export default function PulseTrendAnalysisSection({
  loading,
  error,
  orderedStages,
  divergenceFlags,
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
        <p className="pulse-trend-card__measure">
          The two primary scores - Adoption Readiness and Sponsorship Credibility - track whether change conditions
          are strengthening or weakening across stages.
        </p>
        <div className="table-wrap">
          <table className="pulse-trend-table">
            <thead>
              <tr>
                <th>Series</th>
                {stageColumns.map((label) => <th key={`primary-head-${label}`}>{label}</th>)}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Adoption Readiness (/40)</td>
                {orderedStages.map((stage) => <td key={`adopt-${stage.key}`}>{formatScore(stage.adoptionScore)}</td>)}
              </tr>
              <tr>
                <td>Sponsorship Credibility (/40)</td>
                {orderedStages.map((stage) => <td key={`spon-${stage.key}`}>{formatScore(stage.sponsorshipScore)}</td>)}
              </tr>
            </tbody>
          </table>
        </div>
        <p className="pulse-trend-card__signal">
          <strong>{primaryMovementHeadline}</strong>{' '}
          Latest deltas are Adoption {formatDelta(primaryAdoptionDelta)} and Sponsorship {formatDelta(primarySponsorshipDelta)}.
        </p>
      </article>

      <article className="card pulse-trend-card">
        <p className="pulse-trend-card__label">Section 2 - Quadrant Journey</p>
        <p className="pulse-trend-card__measure">
          Quadrant classification tracks whether score movement is improving toward Optimal or drifting into higher risk states.
        </p>
        <div className="pulse-trend-flow">
          {orderedStages.map((stage, idx) => (
            <div key={`quad-${stage.key}`} className="pulse-trend-flow__node">
              <p className="pulse-trend-flow__stage">{stage.label}</p>
              <p className="pulse-trend-flow__quadrant">{stage.quadrant || '--'}</p>
              {idx < orderedStages.length - 1 ? <span className="pulse-trend-flow__arrow">→</span> : null}
            </div>
          ))}
        </div>
        <p className="pulse-trend-card__signal">
          <strong>Current quadrant is {currentStage?.quadrant || '--'}.</strong> Use this trajectory to set leadership intervention priority.
        </p>
      </article>

      <article className="card pulse-trend-card">
        <p className="pulse-trend-card__label">Section 3 - Sponsorship Sub-Score Trend</p>
        <p className="pulse-trend-card__measure">
          Received (MQ9-MQ12) and Capacity (MQ13-MQ16) separate senior-leader sponsorship quality from manager sponsorship capacity.
        </p>
        <div className="table-wrap">
          <table className="pulse-trend-table">
            <thead>
              <tr>
                <th>Series</th>
                {stageColumns.map((label) => <th key={`sub-head-${label}`}>{label}</th>)}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Received (/20)</td>
                {orderedStages.map((stage) => <td key={`rec-${stage.key}`}>{formatScore(stage.receivedAvg)}</td>)}
              </tr>
              <tr>
                <td>Capacity (/20)</td>
                {orderedStages.map((stage) => <td key={`cap-${stage.key}`}>{formatScore(stage.capacityAvg)}</td>)}
              </tr>
            </tbody>
          </table>
        </div>
        <p className="pulse-trend-card__signal">
          <strong>{subScoreHeadline}</strong>{' '}
          Latest deltas: Received {formatDelta(receivedDelta)}, Capacity {formatDelta(capacityDelta)}.
        </p>
      </article>

      <article className="card pulse-trend-card">
        <p className="pulse-trend-card__label">Section 4 - Manager Load Band Shift</p>
        <p className="pulse-trend-card__measure">
          Load band movement shows whether manager capacity is recovering (toward Sustainable) or depleting (toward Overloaded).
        </p>
        <div className="table-wrap">
          <table className="pulse-trend-table">
            <thead>
              <tr>
                <th>Load Band</th>
                {stageColumns.map((label) => <th key={`load-head-${label}`}>{label}</th>)}
              </tr>
            </thead>
            <tbody>
              {['Sustainable', 'Stretched', 'At Capacity', 'Overloaded'].map((band) => (
                <tr key={`band-${band}`}>
                  <td>{band}</td>
                  {orderedStages.map((stage) => (
                    <td key={`band-${band}-${stage.key}`}>{formatPercent(stage.loadBands[band])}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="pulse-trend-card__signal">
          <strong>{overloadHeadline}</strong>{' '}
          Adjust pace and support based on this distribution.
        </p>
      </article>

      <article className="card pulse-trend-card">
        <p className="pulse-trend-card__label">Section 5 - Dimension Trend: Employee Survey</p>
        <p className="pulse-trend-card__measure">
          Employee dimensions track which readiness and sponsorship conditions are improving or deteriorating across stages.
        </p>
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
          <strong>
            {employeeAdoptionMove
              ? `${employeeAdoptionMove.id} shows the largest adoption-side movement (${formatDelta(employeeAdoptionMove.delta)}).`
              : 'No adoption-side movement available yet.'}
          </strong>{' '}
          {employeeSponsorshipMove
            ? `${employeeSponsorshipMove.id} shows the largest sponsorship-side movement (${formatDelta(employeeSponsorshipMove.delta)}).`
            : ''}
        </p>
      </article>

      <article className="card pulse-trend-card">
        <p className="pulse-trend-card__label">Section 6 - Manager Dimension Trend (Selected)</p>
        <p className="pulse-trend-card__measure">
          Change Saturation (1C) and Manager Wellbeing (2D) are shown because both directly contribute to manager load and sponsorship chain resilience.
        </p>
        <div className="table-wrap">
          <table className="pulse-trend-table">
            <thead>
              <tr>
                <th>Dimension</th>
                {stageColumns.map((label) => <th key={`mgr-head-${label}`}>{label}</th>)}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>1C Change Saturation</td>
                {orderedStages.map((stage) => <td key={`mgr-1c-${stage.key}`}>{formatScore(stage.dimensions.manager['1C'])}</td>)}
              </tr>
              <tr>
                <td>2D Manager Wellbeing</td>
                {orderedStages.map((stage) => <td key={`mgr-2d-${stage.key}`}>{formatScore(stage.dimensions.manager['2D'])}</td>)}
              </tr>
            </tbody>
          </table>
        </div>
        <p className="pulse-trend-card__signal">
          <strong>{managerConstraintHeadline}</strong>{' '}
          Use this as an early warning for sponsorship chain strain.
        </p>
      </article>

      <article className="card pulse-trend-card">
        <p className="pulse-trend-card__label">Section 7 - Sponsorship Chain State Shift</p>
        <p className="pulse-trend-card__measure">
          Chain state distribution shows whether sponsorship transmission from senior leaders through managers is strengthening or fracturing over time.
        </p>
        <div className="table-wrap">
          <table className="pulse-trend-table">
            <thead>
              <tr>
                <th>Chain State</th>
                {stageColumns.map((label) => <th key={`chain-head-${label}`}>{label}</th>)}
              </tr>
            </thead>
            <tbody>
              {['Chain Functioning', 'Breaking at Manager Level', 'Managers Resilient, Under-Supported', 'Sponsorship Failed at Both Levels'].map((state) => (
                <tr key={`chain-${state}`}>
                  <td>{state}</td>
                  {orderedStages.map((stage) => (
                    <td key={`chain-${state}-${stage.key}`}>{formatPercent(stage.chainStates[state])}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="pulse-trend-card__signal">
          <strong>Chain Functioning is {formatPercent(currentStage?.chainStates['Chain Functioning'])} at the current stage.</strong>{' '}
          Delta vs prior stage: {formatDelta(chainFunctioningDelta)}pp.
        </p>
      </article>

      <article className="card pulse-trend-card">
        <p className="pulse-trend-card__label">Section 8 - Perception Gap Trend</p>
        <p className="pulse-trend-card__measure">
          Perception gap compares employee sponsorship experience against manager self-assessment to detect overestimation or underestimation of sponsorship delivery.
        </p>
        <div className="table-wrap">
          <table className="pulse-trend-table">
            <thead>
              <tr>
                <th>Series</th>
                {stageColumns.map((label) => <th key={`gap-head-${label}`}>{label}</th>)}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Employee Sponsorship Avg (2A-2D)</td>
                {orderedStages.map((stage) => <td key={`emp-gap-${stage.key}`}>{formatScore(stage.employeeSponsorshipAvg)}</td>)}
              </tr>
              <tr>
                <td>Manager Sponsorship Avg (2A-2D)</td>
                {orderedStages.map((stage) => <td key={`mgr-gap-${stage.key}`}>{formatScore(stage.managerSponsorshipAvg)}</td>)}
              </tr>
              <tr>
                <td>Gap (Manager - Employee)</td>
                {orderedStages.map((stage) => <td key={`gap-val-${stage.key}`}>{formatDelta(stage.perceptionGap)}</td>)}
              </tr>
            </tbody>
          </table>
        </div>
        <p className="pulse-trend-card__signal">
          <strong>{perceptionGapHeadline}</strong>{' '}
          Track whether the gap narrows or widens in the next wave.
        </p>
      </article>

      <article className="card pulse-trend-card">
        <p className="pulse-trend-card__label">Section 9 - Cross-Stage Divergence Flags</p>
        <p className="pulse-trend-card__measure">
          Divergence flags surface dimensions where adjacent-stage movement is material (absolute change of 1.0+ points on the 1.0-5.0 scale).
        </p>
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
                    <td>{flag.delta > 0 ? 'Improved' : 'Declined'}</td>
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
            <strong>
              {divergenceFlags[0].delta > 0 ? 'Largest flagged movement is an improvement.' : 'Largest flagged movement is a decline.'}
            </strong>{' '}
            Prioritise intervention around {divergenceFlags[0].dimensionId} ({divergenceFlags[0].transition}).
          </p>
        ) : null}
      </article>
    </section>
  );
}
