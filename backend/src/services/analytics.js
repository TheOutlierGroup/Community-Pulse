import { THEMES } from './pulseEngine.js';

function themeLabel(id) {
  return THEMES.find((t) => t.id === id)?.label || id;
}

/**
 * Aggregate employee_responses rows for admin views.
 */
export function aggregateSessionResponses(rows) {
  const total = rows.length;
  const completed = rows.filter((r) => r.completed_at).length;
  const participationRate = total > 0 ? completed / total : 0;

  let npsSum = 0;
  let npsCount = 0;
  const frictionSum = Object.fromEntries(THEMES.map((t) => [t.id, 0]));
  const energySum = Object.fromEntries(THEMES.map((t) => [t.id, 0]));
  const priorityCounts = Object.fromEntries(THEMES.map((t) => [t.id, 0]));
  const comments = [];

  for (const r of rows) {
    if (!r.completed_at) continue;
    const s1 = r.step1_data?.ratings || {};
    const s2 = r.step2_data?.priorityOrder || [];
    const s3 = r.step3_data?.energy || {};
    const s4 = r.step4_data || {};

    if (typeof s4.nps === 'number') {
      npsSum += s4.nps;
      npsCount += 1;
    }
    if (s4.comment) comments.push(s4.comment);

    for (const t of THEMES) {
      if (typeof s1[t.id] === 'number') frictionSum[t.id] += s1[t.id];
      if (typeof s3[t.id] === 'number') energySum[t.id] += s3[t.id];
    }
    const top = s2[0];
    if (top && frictionSum[top] !== undefined) priorityCounts[top] += 1;
  }

  const denom = Math.max(completed, 1);
  const frictionAverages = THEMES.map((t) => ({
    id: t.id,
    label: t.label,
    avg: frictionSum[t.id] / denom,
  })).sort((a, b) => a.avg - b.avg);

  const energyAverages = THEMES.map((t) => ({
    id: t.id,
    label: t.label,
    avg: energySum[t.id] / denom,
  })).sort((a, b) => a.avg - b.avg);

  const hotspots = frictionAverages.filter((x) => x.avg <= 2.4).map((x) => x.label);
  const strengths = frictionAverages.filter((x) => x.avg >= 3.6).map((x) => x.label);

  const heatmap = THEMES.map((t) => ({
    theme: t.label,
    friction: frictionSum[t.id] / denom,
    energy: energySum[t.id] / denom,
  }));

  const sortedPriority = Object.entries(priorityCounts).sort((a, b) => b[1] - a[1]);
  const tensionPairs = [];
  if (sortedPriority.length >= 2) {
    const a = themeLabel(sortedPriority[0][0]);
    const b = themeLabel(sortedPriority[1][0]);
    tensionPairs.push(`${a} vs ${b}`);
  }

  const styleMix = {};
  for (const r of rows) {
    if (!r.contribution_style) continue;
    styleMix[r.contribution_style] = (styleMix[r.contribution_style] || 0) + 1;
  }

  const narrative = buildNarrative({
    completed,
    participationRate,
    avgNps: npsCount ? npsSum / npsCount : 0,
    hotspots,
    strengths,
    tensionPairs,
  });

  return {
    totalResponses: total,
    completed,
    participationRate,
    avgNps: npsCount ? npsSum / npsCount : null,
    frictionAverages,
    energyAverages,
    hotspots,
    strengths,
    heatmap,
    tensionPairs,
    priorityCounts: sortedPriority.map(([id, c]) => ({ id, label: themeLabel(id), count: c })),
    styleMix,
    sampleComments: comments.slice(0, 12),
    narrative,
  };
}

function buildNarrative({ completed, participationRate, avgNps, hotspots, strengths, tensionPairs }) {
  const parts = [];
  parts.push(
    `Based on ${completed} completed diagnostic${completed === 1 ? '' : 's'}, participation is at ${Math.round(participationRate * 100)}% of invited respondents.`
  );
  if (avgNps != null && !Number.isNaN(avgNps)) {
    parts.push(`Average advocacy sits around ${avgNps.toFixed(1)} out of 10 — useful as a headline signal alongside qualitative comments.`);
  }
  if (hotspots.length) {
    parts.push(`Friction clusters most around: ${hotspots.join(', ')}. These are good candidates for targeted leadership attention.`);
  } else {
    parts.push('No extreme friction cluster yet — validate with managers where day-to-day work still feels uneven.');
  }
  if (strengths.length) {
    parts.push(`Protect what is working: ${strengths.join(', ')}.`);
  }
  if (tensionPairs.length) {
    parts.push(`Tension may show up between ${tensionPairs[0]} — clarify ownership and handoffs there first.`);
  }
  return parts.join(' ');
}
