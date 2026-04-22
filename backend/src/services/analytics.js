import { DIMENSIONS, scoreResponseFromSteps } from './pulseEngine.js';

/**
 * Aggregate employee_responses rows for admin views.
 */
export function aggregateSessionResponses(rows) {
  const total = rows.length;
  const completedRows = rows.filter((r) => r.completed_at);
  const completed = completedRows.length;
  const participationRate = total > 0 ? completed / total : 0;

  const scoredRows = completedRows
    .map((r) => {
      const audience = r?.role === 'admin' || r?.survey_role === 'manager' ? 'manager' : 'staff';
      return scoreResponseFromSteps(
        r.step1_data,
        r.step2_data,
        r.step3_data,
        r.step4_data,
        audience,
        r.stage || 'pre'
      );
    })
    .filter((result) => result.valid);

  const adoptionAvg =
    scoredRows.length > 0
      ? scoredRows.reduce((sum, result) => sum + result.adoption, 0) / scoredRows.length
      : null;
  const sponsorshipAvg =
    scoredRows.length > 0
      ? scoredRows.reduce((sum, result) => sum + result.sponsorship, 0) / scoredRows.length
      : null;

  const comments = [];
  for (const r of completedRows) {
    const note = r?.step4_data?.comment;
    if (typeof note === 'string' && note.trim()) comments.push(note.trim());
  }

  const dimensionAverages = DIMENSIONS.map((dimension) => {
    const values = scoredRows
      .map((result) => result.dimensions.find((d) => d.id === dimension.id))
      .filter(Boolean)
      .map((d) => d.average);
    const avg =
      values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
    return {
      id: dimension.id,
      label: dimension.employeeLabel,
      avg,
    };
  }).sort((a, b) => (a.avg ?? 0) - (b.avg ?? 0));

  const frictionAverages = dimensionAverages;
  const energyAverages = dimensionAverages;
  const hotspots = frictionAverages.filter((x) => (x.avg ?? 0) < 2.5).map((x) => x.label);
  const strengths = frictionAverages.filter((x) => (x.avg ?? 0) >= 4).map((x) => x.label);
  const heatmap = DIMENSIONS.map((dimension) => {
    const avg = dimensionAverages.find((entry) => entry.id === dimension.id)?.avg ?? null;
    return {
      theme: dimension.employeeLabel,
      friction: avg,
      energy: avg,
    };
  });
  const tensionPairs = [];

  const styleMix = {};
  for (const scored of scoredRows) {
    styleMix[scored.quadrantLabel] = (styleMix[scored.quadrantLabel] || 0) + 1;
  }

  const narrative = buildNarrative({
    completed,
    participationRate,
    adoptionAvg,
    sponsorshipAvg,
    hotspots,
    strengths,
    tensionPairs,
  });

  return {
    totalResponses: total,
    completed,
    participationRate,
    avgNps: null,
    frictionAverages,
    energyAverages,
    hotspots,
    strengths,
    heatmap,
    tensionPairs,
    priorityCounts: [],
    styleMix,
    sampleComments: comments.slice(0, 12),
    narrative,
  };
}

function buildNarrative({
  completed,
  participationRate,
  adoptionAvg,
  sponsorshipAvg,
  hotspots,
  strengths,
  tensionPairs,
}) {
  const parts = [];
  parts.push(
    `Based on ${completed} completed diagnostic${completed === 1 ? '' : 's'}, participation is at ${Math.round(participationRate * 100)}% of invited respondents.`
  );
  if (adoptionAvg != null && sponsorshipAvg != null) {
    parts.push(
      `Average Adoption is ${adoptionAvg.toFixed(1)}/40 and Sponsorship is ${sponsorshipAvg.toFixed(1)}/40.`
    );
  }
  if (hotspots.length) {
    parts.push(`Lowest dimensions are: ${hotspots.join(', ')}. These are immediate priorities before rollout.`);
  } else {
    parts.push('No critical dimension floor detected yet — validate with managers where confidence still looks uneven.');
  }
  if (strengths.length) {
    parts.push(`Protect what is working: ${strengths.join(', ')}.`);
  }
  if (tensionPairs.length) {
    parts.push(`Tension may show up between ${tensionPairs[0]} — clarify ownership and handoffs there first.`);
  }
  return parts.join(' ');
}
