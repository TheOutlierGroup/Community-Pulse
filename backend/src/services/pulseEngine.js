/**
 * Derives contribution style and reflection copy from Pulse step payloads.
 * Themes align with product narrative: friction, energy, priorities, sentiment.
 */

const THEMES = [
  { id: 'alignment', label: 'Clarity & alignment' },
  { id: 'ownership', label: 'Ownership & decisions' },
  { id: 'collaboration', label: 'Cross-team collaboration' },
  { id: 'pace', label: 'Pace & sustainable delivery' },
  { id: 'support', label: 'Manager support' },
  { id: 'customer', label: 'Customer impact visibility' },
];

function normalizeStep1(step1) {
  const ratings = step1?.ratings || {};
  const scores = THEMES.map((t) => ({
    id: t.id,
    label: t.label,
    value: typeof ratings[t.id] === 'number' ? ratings[t.id] : 3,
  }));
  return scores;
}

function normalizeStep2(step2) {
  const order = Array.isArray(step2?.priorityOrder) ? step2.priorityOrder : THEMES.map((t) => t.id);
  return order.filter((id) => THEMES.some((t) => t.id === id));
}

function normalizeStep3(step3) {
  const energy = step3?.energy || {};
  return THEMES.map((t) => ({
    id: t.id,
    label: t.label,
    value: typeof energy[t.id] === 'number' ? energy[t.id] : 3,
  }));
}

function normalizeStep4(step4) {
  return {
    nps: typeof step4?.nps === 'number' ? Math.max(0, Math.min(10, step4.nps)) : 5,
    comment: typeof step4?.comment === 'string' ? step4.comment.trim().slice(0, 5000) : '',
  };
}

export function computeContributionStyle(step1, step2, step3) {
  const s1 = normalizeStep1(step1);
  const order = normalizeStep2(step2);
  const s3 = normalizeStep3(step3);

  const frictionAvg =
    s1.reduce((a, b) => a + b.value, 0) / Math.max(s1.length, 1);
  const energyAvg =
    s3.reduce((a, b) => a + b.value, 0) / Math.max(s3.length, 1);

  const topPriority = order[0] || 'alignment';
  const hardest = [...s1].sort((a, b) => a.value - b.value)[0];
  const drain = [...s3].sort((a, b) => a.value - b.value)[0];

  let style = 'Steady Contributor';
  if (frictionAvg <= 2.2 && energyAvg >= 3.5) style = 'Momentum Builder';
  else if (frictionAvg <= 2.5 && topPriority === 'collaboration') style = 'Connector';
  else if (hardest?.id === 'pace' || drain?.id === 'pace') style = 'Load Bearer';
  else if (hardest?.id === 'alignment' || topPriority === 'alignment') style = 'Alignment Seeker';
  else if (energyAvg <= 2.3) style = 'Energy Guardian';

  return {
    style,
    summary: {
      frictionThemes: s1.filter((x) => x.value <= 2).map((x) => x.label),
      energizers: s3.filter((x) => x.value >= 4).map((x) => x.label),
      drains: s3.filter((x) => x.value <= 2).map((x) => x.label),
      topPriorityId: topPriority,
    },
  };
}

export function buildPersonalReflection(step1, step2, step3, step4, contribution) {
  const s4 = normalizeStep4(step4);
  const { style, summary } = contribution;

  const thrive =
    summary.energizers.length > 0
      ? summary.energizers.slice(0, 2).join(' and ')
      : 'conditions that feel clear and supported';
  const support =
    summary.drains.length > 0
      ? summary.drains.slice(0, 2).join(' and ')
      : 'areas that feel heavier day to day';

  return {
    contributionStyle: style,
    thrive,
    needsSupport: support,
    advocacy: s4.nps,
    closingNote:
      s4.comment ||
      'Your reflection is captured. Leaders see patterns in aggregate — your voice adds important context.',
  };
}

export function buildActionPlanDraft(aggregates) {
  const { hotspots, strengths, tensionPairs, participationRate, avgNps } = aggregates;

  return {
    thirtyDays: [
      `Acknowledge signals: share headline themes with leads (${Math.round(participationRate * 100)}% participation).`,
      hotspots.length
        ? `Focus first on: ${hotspots.slice(0, 2).join(', ')}.`
        : 'Confirm top friction themes with a short manager listening tour.',
      'Run two 45-minute alignment sessions on the top-ranked priority behaviours.',
    ],
    sixtyDays: [
      'Assign owners for the top 3 drag factors; track weekly with a simple RAG status.',
      tensionPairs.length
        ? `Reduce cross-team tension between: ${tensionPairs[0]}.`
        : 'Clarify decision rights between Product, Ops, and Customer-facing teams.',
      strengths.length
        ? `Protect strengths: ${strengths.slice(0, 2).join(', ')}.`
        : 'Double down on what already feels easy for teams.',
    ],
    ninetyDays: [
      `Embed a lightweight pulse rhythm; re-check advocacy (current avg ${avgNps.toFixed(1)}/10).`,
      'Publish a short “what we changed / what is next” note to the org.',
      'Review heatmaps and tension map with leadership; adjust resourcing if drag persists.',
    ],
    meta: { generatedAt: new Date().toISOString() },
  };
}

export { THEMES };
