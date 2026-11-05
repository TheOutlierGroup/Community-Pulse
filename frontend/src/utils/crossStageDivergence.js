// Trend Analysis, Section 9 (Cross-Stage Divergence Flags).
//
// RED-046: with results for only one checkpoint, the section said "Score
// movements across all dimensions are within expected variation", which
// claims a comparison that never happened. It read as broken. The empty
// state now says why nothing is shown: nothing to compare yet, nothing
// comparable (scores withheld for small groups), or genuinely no material
// movement.

export const DIVERGENCE_DIMENSION_ORDER = ['1A', '1B', '1C', '1D', '2A', '2B', '2C', '2D'];
const AUDIENCES = [
  { key: 'employee', label: 'Employee' },
  { key: 'manager', label: 'Manager' },
];

function adjacentAvailablePairs(orderedStages) {
  const pairs = [];
  for (let idx = 1; idx < orderedStages.length; idx += 1) {
    const from = orderedStages[idx - 1];
    const to = orderedStages[idx];
    if (!from?.available || !to?.available) continue;
    pairs.push([from, to]);
  }
  return pairs;
}

function dimensionValue(stage, audience, dimensionId) {
  const value = stage?.dimensions?.[audience]?.[dimensionId];
  return Number.isFinite(value) ? value : null;
}

function stageHasDimensionData(stage, dimensionOrder) {
  if (!stage?.available) return false;
  return AUDIENCES.some(({ key }) =>
    dimensionOrder.some((dimensionId) => dimensionValue(stage, key, dimensionId) != null)
  );
}

export function buildCrossStageDivergenceFlags(
  orderedStages,
  threshold = 1.0,
  dimensionOrder = DIVERGENCE_DIMENSION_ORDER
) {
  const flags = [];
  for (const [from, to] of adjacentAvailablePairs(orderedStages || [])) {
    for (const dimensionId of dimensionOrder) {
      for (const { key, label } of AUDIENCES) {
        const fromValue = dimensionValue(from, key, dimensionId);
        const toValue = dimensionValue(to, key, dimensionId);
        if (fromValue == null || toValue == null) continue;
        const delta = toValue - fromValue;
        if (Math.abs(delta) < threshold) continue;
        flags.push({
          key: `${key}-${dimensionId}-${from.key}-${to.key}`,
          dimensionId,
          survey: label,
          transition: `${from.label} -> ${to.label}`,
          from: fromValue,
          to: toValue,
          delta,
        });
      }
    }
  }
  return flags.sort((a, b) => {
    const absDiff = Math.abs(b.delta) - Math.abs(a.delta);
    if (absDiff !== 0) return absDiff;
    if (a.delta < 0 && b.delta > 0) return -1;
    if (a.delta > 0 && b.delta < 0) return 1;
    return a.dimensionId.localeCompare(b.dimensionId);
  });
}

function joinLabels(labels) {
  if (labels.length <= 1) return labels.join('');
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}

/**
 * Why Section 9 has no flags, as one of:
 *  - 'no-data':        no checkpoint has dimension results yet
 *  - 'single-stage':   only one checkpoint has results, nothing to compare
 *  - 'not-comparable': two or more do, but no dimension can be compared
 *                      between consecutive checkpoints (a checkpoint in
 *                      between has no results, or scores are withheld)
 *  - 'within-range':   comparisons were made and none reached the threshold
 * Returns null when there are flags to show.
 */
export function describeDivergenceEmptyState(
  orderedStages,
  flags,
  dimensionOrder = DIVERGENCE_DIMENSION_ORDER
) {
  if (Array.isArray(flags) && flags.length > 0) return null;
  const stages = orderedStages || [];
  const withData = stages.filter((stage) => stageHasDimensionData(stage, dimensionOrder));
  const labels = withData.map((stage) => stage.label);

  if (withData.length === 0) {
    return {
      reason: 'no-data',
      message:
        'Nothing to compare yet. Divergence flags compare dimension scores between checkpoints, and no checkpoint has results yet.',
    };
  }
  if (withData.length === 1) {
    return {
      reason: 'single-stage',
      message: `Nothing to compare yet. Divergence flags compare dimension scores between checkpoints, and only ${labels[0]} has results so far. Flags will appear here once the next checkpoint has responses.`,
    };
  }

  const comparedSomething = adjacentAvailablePairs(stages).some(([from, to]) =>
    AUDIENCES.some(({ key }) =>
      dimensionOrder.some(
        (dimensionId) => dimensionValue(from, key, dimensionId) != null && dimensionValue(to, key, dimensionId) != null
      )
    )
  );
  if (!comparedSomething) {
    return {
      reason: 'not-comparable',
      message: `${joinLabels(labels)} have results, but no dimension can be compared between consecutive checkpoints yet. This happens when the checkpoint in between has no results, or when scores are withheld because fewer than 5 people in a group responded.`,
    };
  }
  return {
    reason: 'within-range',
    message:
      'No cross-stage divergence flags at this stage. Score movements across all dimensions are within expected variation (±1.0 point).',
  };
}
