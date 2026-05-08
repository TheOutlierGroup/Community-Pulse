import { READINESS_THRESHOLD } from './pulseEngine.js';

const ALERT_PRIORITY = {
  critical: 0,
  warning: 1,
  info: 2,
};

export const SCORE_CARD_SIGNAL_PROMPTS = Object.freeze({
  adoption: Object.freeze({
    system:
      'You are a change readiness analyst writing a single descriptive sentence for a dashboard score card. Maximum 1 sentence. No hedging. No classification labels. Do not use the words "High Risk", "Optimal", "Capable Wary", or "Motivated but Lost".',
    user:
      'Organisation: {{client_name}} | Stage: {{assessment_stage}} | Respondents: {{respondent_count}} (all employees and managers)\n\nAdoption Readiness score: {{adoption_score}}/40 | Threshold: 28 | Modal quadrant across all respondents: {{modal_quadrant}}\n\nWrite one sentence that states, generically, where the majority of respondents sit — using the quadrant name only — without leading with a verdict or classification. For example: "With the majority of respondents sitting within the [quadrant] quadrant, this score reflects how employees and managers collectively experience their capacity and conditions to absorb this change."',
    fallback:
      'With the majority of respondents sitting within the {{modal_quadrant}} quadrant, this score reflects how employees and managers collectively experience their readiness to absorb this change.',
  }),
  sponsorship: Object.freeze({
    system:
      'You are a change readiness analyst writing a single descriptive sentence for a dashboard score card. Maximum 1 sentence. No hedging. No classification labels. Do not use the words "High Risk", "Optimal", "Capable Wary", or "Motivated but Lost".',
    user:
      'Organisation: {{client_name}} | Stage: {{assessment_stage}} | Respondents: {{respondent_count}} (all employees and managers)\n\nSponsorship Credibility score: {{sponsorship_score}}/40 | Threshold: 28 | Modal quadrant across all respondents: {{modal_quadrant}}\n\nWrite one sentence that states, generically, where the majority of respondents sit — using the quadrant name only — without leading with a verdict or classification. For example: "With the majority of respondents sitting within the [quadrant] quadrant, this score reflects how employees and managers collectively experience the credibility and visibility of leadership sponsorship."',
    fallback:
      'With the majority of respondents sitting within the {{modal_quadrant}} quadrant, this score reflects how employees and managers collectively experience the credibility and visibility of leadership sponsorship.',
  }),
  likelihood: Object.freeze({
    system:
      'You are a change readiness analyst writing a concise signal for a C-suite practitioner dashboard. Maximum 2 sentences. Be direct and decisive — this is a board-level audience. No hedging. Wrap the single most important finding in <strong> tags. Do not restate the score numbers — interpret what they mean.',
    user:
      'Organisation: {{client_name}} | Adoption: {{adoption_score}}/40 ({{adoption_threshold_status}}) | Sponsorship: {{sponsorship_score}}/40 ({{sponsorship_threshold_status}}) | Current quadrant (org avg): {{current_quadrant}} | Quadrant distribution: Optimal {{optimal_pct}}%, Motivated Lost {{motivated_lost_pct}}%, Capable Wary {{capable_wary_pct}}%, High Risk {{high_risk_pct}}% | Launch status: {{launch_status}}\n\nWrite a 2-sentence signal that: (1) states what the quadrant distribution reveals about the spread of readiness across the organisation — not just the modal quadrant, and (2) names the single most important implication for how leadership should respond before or during launch.',
    fallback:
      'The quadrant distribution shows how individuals are spread across all four readiness states. Review the proportion outside Optimal to determine the scale and nature of intervention required.',
  }),
  quadrant: Object.freeze({
    system:
      "You are a change readiness analyst writing a concise signal banner for a senior practitioner dashboard for RhythmEngine — a proprietary diagnostic tool that measures an organisation's readiness to absorb and sustain a specific change programme. The quadrant distribution is the primary output of the instrument and the most important data on this page. Your output will be rendered as italicised prose. Write in plain English. Be direct and factual. Do not hedge. Do not use bullet points. Maximum 3 sentences. Wrap the single most important finding in <strong> tags. Express all proportions as percentages only — never as fractions or ratios. Do not manufacture urgency where the data does not support it, but do not soften findings where it does. Always lead with the strongest positive in the distribution before addressing the deficit. When naming the deficit, prioritise High Risk above all other non-Optimal states — if High Risk is the largest non-Optimal segment, it must be named first and directly. If the current quadrant outcome is Optimal, do not state that nothing needs to be done — instead acknowledge the result honestly, then close with a brief forward-looking statement about sustaining conditions and monitoring as the programme progresses, without implying a specific problem exists.",
    user:
      'Organisation: {{client_name}} | Stage: {{assessment_stage}} | Respondents: {{respondent_count}}\nQuadrant distribution: Optimal {{optimal_pct}}% | Motivated but Lost {{motivated_lost_pct}}% | Capable but Wary {{capable_wary_pct}}% | High Risk {{high_risk_pct}}%\nOrg-level classification: {{org_quadrant}}\nLargest non-Optimal segment: {{largest_deficit_quadrant}} ({{largest_deficit_pct}}%)\n\nWrite a 3-sentence signal banner that: (1) states what the quadrant distribution represents — that it shows the proportion of the organisation that currently has the conditions in place to absorb and sustain this change, versus those that do not; (2) leads with the Optimal percentage as the positive finding, then names the largest deficit segment — prioritising High Risk if it is the largest — and its percentage; and (3) states what closing that gap requires in plain terms, referencing whether the primary barrier is sponsorship, adoption readiness, or both.',
    fallback:
      'The quadrant distribution shows what proportion of the organisation currently has the conditions in place to absorb and sustain this change. Review the Optimal percentage against the largest deficit segment to understand the scale of intervention required before this programme can proceed with confidence.',
  }),
});

function renderPromptTemplate(template, values) {
  return String(template || '').replace(/\{\{([^}]+)\}\}/g, (_full, key) => {
    const normalizedKey = String(key || '').trim();
    const value = values?.[normalizedKey];
    if (value == null) return '';
    return String(value);
  });
}

export function calculateLargestRemainderPercentages(counts) {
  const values = counts.map((count) => Number(count) || 0);
  const total = values.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return values.map(() => 0);

  const raw = values.map((value) => (value / total) * 100);
  const floors = raw.map((value) => Math.floor(value));
  let remainder = 100 - floors.reduce((sum, value) => sum + value, 0);

  const ranked = raw
    .map((value, idx) => ({ idx, frac: value - Math.floor(value) }))
    .sort((a, b) => {
      if (b.frac !== a.frac) return b.frac - a.frac;
      return a.idx - b.idx;
    });

  for (let i = 0; i < ranked.length && remainder > 0; i += 1) {
    floors[ranked[i].idx] += 1;
    remainder -= 1;
  }

  return floors;
}

function scoreCrossedThreshold(current, previous, threshold) {
  if (current == null || previous == null) return null;
  const isCurrentHigh = current >= threshold;
  const wasPreviousHigh = previous >= threshold;
  if (isCurrentHigh === wasPreviousHigh) return null;
  return isCurrentHigh ? 'up' : 'down';
}

export function buildThresholdCrossingAlerts({
  currentAdoption,
  previousAdoption,
  currentSponsorship,
  previousSponsorship,
  threshold = READINESS_THRESHOLD,
}) {
  const alerts = [];
  const adoptionDirection = scoreCrossedThreshold(currentAdoption, previousAdoption, threshold);
  if (adoptionDirection === 'up') {
    alerts.push({
      level: 'info',
      title: 'Adoption threshold crossed upward',
      body: `Adoption moved from below to above ${threshold} compared with the previous period.`,
    });
  } else if (adoptionDirection === 'down') {
    alerts.push({
      level: 'warning',
      title: 'Adoption threshold crossed downward',
      body: `Adoption moved from above to below ${threshold} compared with the previous period.`,
    });
  }

  const sponsorshipDirection = scoreCrossedThreshold(
    currentSponsorship,
    previousSponsorship,
    threshold
  );
  if (sponsorshipDirection === 'up') {
    alerts.push({
      level: 'info',
      title: 'Sponsorship threshold crossed upward',
      body: `Sponsorship moved from below to above ${threshold} compared with the previous period.`,
    });
  } else if (sponsorshipDirection === 'down') {
    alerts.push({
      level: 'warning',
      title: 'Sponsorship threshold crossed downward',
      body: `Sponsorship moved from above to below ${threshold} compared with the previous period.`,
    });
  }

  return alerts;
}

export function prioritizeAndCapAlerts(alerts, limit = 5) {
  const sorted = [...alerts].sort((a, b) => {
    const aPriority = ALERT_PRIORITY[a.level] ?? 99;
    const bPriority = ALERT_PRIORITY[b.level] ?? 99;
    if (aPriority !== bPriority) return aPriority - bPriority;
    return String(a.title || '').localeCompare(String(b.title || ''));
  });
  const capped = sorted.slice(0, Math.max(0, limit));
  return {
    alerts: capped,
    overflowCount: Math.max(0, sorted.length - capped.length),
  };
}

export function verdictForScores(adoption, sponsorship, threshold = READINESS_THRESHOLD) {
  if (adoption == null || sponsorship == null) return 'insufficient_data';
  return adoption >= threshold && sponsorship >= threshold ? 'cleared' : 'not_cleared';
}

export function headlineForVerdict(verdict) {
  if (verdict === 'cleared') return 'Cleared for Launch';
  if (verdict === 'not_cleared') return 'Not Cleared for Launch';
  return 'Insufficient data for launch verdict';
}

export function buildSponsorshipDecliningAlert({
  currentSponsorship,
  previousSponsorship,
  declineThreshold = 1.0,
}) {
  if (currentSponsorship == null || previousSponsorship == null) return [];
  const delta = currentSponsorship - previousSponsorship;
  if (delta < -declineThreshold) {
    return [
      {
        level: 'warning',
        title: 'Sponsorship declining',
        body: `Average sponsorship has dropped ${Math.abs(delta).toFixed(1)} points compared with the previous period.`,
      },
    ];
  }
  return [];
}

export function buildTeamOutlierAlerts({
  byManager,
  orgAdoptionScore,
  orgSponsorshipScore,
  gapThreshold = 8,
  minTeamSize = 5,
}) {
  const alerts = [];
  for (const manager of byManager || []) {
    if ((manager.directReportCompletedCount || 0) < minTeamSize) continue;
    const adoptionGap =
      orgAdoptionScore != null && manager.adoptionScore != null
        ? orgAdoptionScore - manager.adoptionScore
        : null;
    const sponsorshipGap =
      orgSponsorshipScore != null && manager.sponsorshipScore != null
        ? orgSponsorshipScore - manager.sponsorshipScore
        : null;
    const name = manager.managerName || manager.managerEmail || 'Unknown manager';
    if (adoptionGap != null && adoptionGap > gapThreshold) {
      alerts.push({
        level: 'warning',
        title: `Team outlier: ${name}`,
        body: `${name}'s team adoption score is ${adoptionGap.toFixed(1)} points below the org average.`,
      });
    }
    if (sponsorshipGap != null && sponsorshipGap > gapThreshold) {
      alerts.push({
        level: 'warning',
        title: `Team outlier: ${name}`,
        body: `${name}'s team sponsorship score is ${sponsorshipGap.toFixed(1)} points below the org average.`,
      });
    }
  }
  return alerts;
}

export function buildDimensionFloorAlerts({ dimensions, threshold = 2.5 }) {
  const alerts = [];
  for (const dim of dimensions || []) {
    if (dim.energyAvg != null && dim.energyAvg < threshold) {
      alerts.push({
        level: 'warning',
        title: `Dimension floor: ${dim.label}`,
        body: `${dim.label} average is ${dim.energyAvg.toFixed(1)}/5.0 — below the critical threshold of ${threshold}.`,
      });
    }
    if (dim.frictionAvg != null && dim.frictionAvg < threshold) {
      alerts.push({
        level: 'warning',
        title: `Dimension floor: ${dim.managerLabel}`,
        body: `${dim.managerLabel} average is ${dim.frictionAvg.toFixed(1)}/5.0 — below the critical threshold of ${threshold}.`,
      });
    }
  }
  return alerts;
}

function pct(value) {
  return `${Math.round(Number(value) || 0)}%`;
}

function formatScoreOutOf40(value) {
  if (!Number.isFinite(value)) return '--';
  return Number(value).toFixed(1);
}

function formatScoreOutOf20(value) {
  if (!Number.isFinite(value)) return '--';
  return Number(value).toFixed(1);
}

function thresholdStatusLabel(score, threshold) {
  if (!Number.isFinite(score) || !Number.isFinite(threshold)) return 'Unknown';
  return score >= threshold ? 'Above' : 'Below';
}

function safeQuadrantName(value) {
  const normalized = String(value || '').trim();
  return normalized || 'Unknown';
}

function sponsorshipDeficitAnchor({
  receivedScore,
  capacityScore,
  subScoreThreshold,
}) {
  const receivedFinite = Number.isFinite(receivedScore);
  const capacityFinite = Number.isFinite(capacityScore);
  if (!receivedFinite || !capacityFinite) return 'insufficient_data';
  const receivedBelow = receivedScore < subScoreThreshold;
  const capacityBelow = capacityScore < subScoreThreshold;
  if (receivedBelow && capacityBelow) return 'both';
  if (receivedBelow) return 'received';
  if (capacityBelow) return 'capacity';
  return receivedScore <= capacityScore ? 'received' : 'capacity';
}

export function buildAdoptionScoreCardSignal({
  clientName,
  adoptionScore,
  threshold = 28,
  currentQuadrant,
  modalQuadrant,
  assessmentStage,
  respondentCount,
}) {
  const scoreText = formatScoreOutOf40(adoptionScore);
  const modalQuadrantLabel = safeQuadrantName(modalQuadrant ?? currentQuadrant);
  const fallback = renderPromptTemplate(
    SCORE_CARD_SIGNAL_PROMPTS.adoption.fallback,
    { modal_quadrant: modalQuadrantLabel }
  );
  const blurb = fallback;
  const promptContext = {
    clientName: String(clientName || '').trim() || null,
    assessmentStage: assessmentStage || null,
    respondentCount: Number.isFinite(Number(respondentCount)) ? Number(respondentCount) : null,
    adoptionScore: scoreText,
    modalQuadrant: modalQuadrantLabel,
  };
  if (!Number.isFinite(adoptionScore)) {
    return {
      text: fallback,
      blurb,
      fallback,
      status: 'Unknown',
      score: scoreText,
      modalQuadrant: modalQuadrantLabel,
      promptContext,
    };
  }

  const status = thresholdStatusLabel(adoptionScore, threshold);
  const orgLabel = String(clientName || 'This organisation').trim() || 'This organisation';
  const quadrantLabel = safeQuadrantName(currentQuadrant);
  const text = status === 'Above'
    ? `<strong>${orgLabel} can absorb additional change load right now</strong>, and the ${quadrantLabel} quadrant shows where execution support must stay targeted to sustain momentum.`
    : `<strong>${orgLabel} cannot absorb additional change load at the current pace</strong>, and the ${quadrantLabel} quadrant shows this readiness deficit is already shaping execution risk.`;
  return {
    text,
    blurb,
    fallback,
    status,
    score: scoreText,
    modalQuadrant: modalQuadrantLabel,
    promptContext,
  };
}

export function buildSponsorshipScoreCardSignal({
  clientName,
  sponsorshipScore,
  threshold = 28,
  receivedScore,
  capacityScore,
  subScoreThreshold = 14,
  currentQuadrant,
  modalQuadrant,
  assessmentStage,
  respondentCount,
}) {
  const scoreText = formatScoreOutOf40(sponsorshipScore);
  const receivedText = formatScoreOutOf20(receivedScore);
  const capacityText = formatScoreOutOf20(capacityScore);
  const modalQuadrantLabel = safeQuadrantName(modalQuadrant ?? currentQuadrant);
  const fallback = renderPromptTemplate(
    SCORE_CARD_SIGNAL_PROMPTS.sponsorship.fallback,
    { modal_quadrant: modalQuadrantLabel }
  );
  const blurb = fallback;
  const promptContext = {
    clientName: String(clientName || '').trim() || null,
    assessmentStage: assessmentStage || null,
    respondentCount: Number.isFinite(Number(respondentCount)) ? Number(respondentCount) : null,
    sponsorshipScore: scoreText,
    modalQuadrant: modalQuadrantLabel,
  };
  if (!Number.isFinite(sponsorshipScore)) {
    return {
      text: fallback,
      blurb,
      fallback,
      status: 'Unknown',
      score: scoreText,
      receivedScore: receivedText,
      capacityScore: capacityText,
      deficitAnchor: 'insufficient_data',
      modalQuadrant: modalQuadrantLabel,
      promptContext,
    };
  }

  const status = thresholdStatusLabel(sponsorshipScore, threshold);
  const orgLabel = String(clientName || 'This organisation').trim() || 'This organisation';
  const quadrantLabel = safeQuadrantName(currentQuadrant);
  const deficitAnchor = sponsorshipDeficitAnchor({
    receivedScore,
    capacityScore,
    subScoreThreshold,
  });
  let deficitClause = 'the ownership of any sponsorship deficit cannot yet be isolated';
  if (deficitAnchor === 'received') {
    deficitClause = 'the primary deficit sits in how sponsorship is being delivered from above';
  } else if (deficitAnchor === 'capacity') {
    deficitClause = 'the primary deficit sits in manager capacity to pass sponsorship on';
  } else if (deficitAnchor === 'both') {
    deficitClause = 'the deficit sits in both sponsorship delivery from above and manager pass-through capacity';
  }
  const text = status === 'Above'
    ? `<strong>Leadership sponsorship is currently credible enough to support rollout</strong>, and ${deficitClause} in the ${quadrantLabel} quadrant to protect continuity through managers.`
    : `<strong>Leadership sponsorship is not credible enough to support rollout at pace</strong>, and ${deficitClause} in the ${quadrantLabel} quadrant.`;
  return {
    text,
    blurb,
    fallback,
    status,
    score: scoreText,
    receivedScore: receivedText,
    capacityScore: capacityText,
    deficitAnchor,
    modalQuadrant: modalQuadrantLabel,
    promptContext,
  };
}

export function buildTopScoreCardSignals({
  clientName,
  adoptionScore,
  sponsorshipScore,
  threshold = 28,
  receivedScore,
  capacityScore,
  subScoreThreshold = 14,
  currentQuadrant,
  modalQuadrant,
  assessmentStage,
  respondentCount,
}) {
  return {
    adoption: buildAdoptionScoreCardSignal({
      clientName,
      adoptionScore,
      threshold,
      currentQuadrant,
      modalQuadrant,
      assessmentStage,
      respondentCount,
    }),
    sponsorship: buildSponsorshipScoreCardSignal({
      clientName,
      sponsorshipScore,
      threshold,
      receivedScore,
      capacityScore,
      subScoreThreshold,
      currentQuadrant,
      modalQuadrant,
      assessmentStage,
      respondentCount,
    }),
  };
}

export function buildLikelihoodWhatThisMeansSignal({
  currentQuadrant,
  optimalPct = 0,
  motivatedLostPct = 0,
  capableWaryPct = 0,
  highRiskPct = 0,
  launchStatus,
}) {
  const fallback = SCORE_CARD_SIGNAL_PROMPTS.likelihood.fallback;
  const hasDistribution = [optimalPct, motivatedLostPct, capableWaryPct, highRiskPct]
    .some((value) => Number.isFinite(value));
  if (!hasDistribution) {
    return {
      text: fallback,
      fallback,
      outsideOptimalPct: null,
    };
  }

  const optimal = Math.max(0, Math.round(Number(optimalPct) || 0));
  const motivated = Math.max(0, Math.round(Number(motivatedLostPct) || 0));
  const wary = Math.max(0, Math.round(Number(capableWaryPct) || 0));
  const highRisk = Math.max(0, Math.round(Number(highRiskPct) || 0));
  const outsideOptimal = Math.max(0, motivated + wary + highRisk);
  const launchNormalized = String(launchStatus || '').trim().toLowerCase();
  const launchCleared = launchNormalized.includes('cleared') && !launchNormalized.includes('not');
  const quadrantLabel = safeQuadrantName(currentQuadrant);
  const spreadSentence = `<strong>${outsideOptimal}% of respondents sit outside Optimal, with readiness split across Motivated but Lost (${motivated}%), Capable but Wary (${wary}%), and High Risk (${highRisk}%) rather than concentrated in a single launch-ready state.</strong>`;
  const actionSentence = launchCleared
    ? `Leadership should proceed with phased deployment from the ${quadrantLabel} base while running targeted sponsorship and capacity actions for non-Optimal cohorts to prevent slippage during rollout.`
    : `Leadership should not execute a broad launch from a ${quadrantLabel} baseline and must run targeted interventions by cohort before or during rollout to avoid predictable execution failure.`;
  return {
    text: `${spreadSentence} ${actionSentence}`,
    fallback,
    outsideOptimalPct: outsideOptimal,
    optimalPct: optimal,
  };
}

const ASSESSMENT_STAGE_LABELS = Object.freeze({
  pre: 'Pre-Change',
  during: 'Mid-Change',
  mid: 'Mid-Change',
  completed: 'Post-Change',
  post: 'Post-Change',
});

export function normalizeAssessmentStageLabel(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return 'Pre-Change';
  if (ASSESSMENT_STAGE_LABELS[raw]) return ASSESSMENT_STAGE_LABELS[raw];
  if (raw.includes('post') || raw.includes('complete')) return 'Post-Change';
  if (raw.includes('mid') || raw.includes('during')) return 'Mid-Change';
  if (raw.includes('pre')) return 'Pre-Change';
  return 'Pre-Change';
}

export function buildQuadrantExplanationSignal({
  optimalPct = 0,
  motivatedLostPct = 0,
  capableWaryPct = 0,
  highRiskPct = 0,
  adoptionScore,
  sponsorshipScore,
  threshold = READINESS_THRESHOLD,
  currentQuadrant = null,
}) {
  const fallback = SCORE_CARD_SIGNAL_PROMPTS.quadrant.fallback;
  const finiteValues = [optimalPct, motivatedLostPct, capableWaryPct, highRiskPct]
    .filter((value) => Number.isFinite(value));
  const distributionTotal = finiteValues.reduce((sum, value) => sum + value, 0);
  if (finiteValues.length === 0 || distributionTotal <= 0) {
    return {
      text: fallback,
      fallback,
      optimalPct: null,
      largestDeficitName: null,
      largestDeficitPct: null,
      largestSegmentName: null,
      bannerVariant: 'green',
      barrier: 'insufficient_data',
    };
  }

  const optimal = Math.max(0, Math.round(Number(optimalPct) || 0));
  const motivated = Math.max(0, Math.round(Number(motivatedLostPct) || 0));
  const wary = Math.max(0, Math.round(Number(capableWaryPct) || 0));
  const highRisk = Math.max(0, Math.round(Number(highRiskPct) || 0));

  // Largest non-Optimal segment, prioritising High Risk on ties.
  // Lower priority value wins ties (High Risk = 0).
  const deficits = [
    { name: 'High Risk', percent: highRisk, priority: 0 },
    { name: 'Capable but Wary', percent: wary, priority: 1 },
    { name: 'Motivated but Lost', percent: motivated, priority: 1 },
  ]
    .filter((entry) => entry.percent > 0)
    .sort((a, b) => {
      if (b.percent !== a.percent) return b.percent - a.percent;
      return a.priority - b.priority;
    });
  const largestDeficit = deficits[0] || null;

  // Largest segment overall — used for banner variant. Optimal wins ties.
  const allSegments = [
    { name: 'Optimal', percent: optimal, priority: 0 },
    { name: 'High Risk', percent: highRisk, priority: 1 },
    { name: 'Capable but Wary', percent: wary, priority: 2 },
    { name: 'Motivated but Lost', percent: motivated, priority: 2 },
  ].sort((a, b) => {
    if (b.percent !== a.percent) return b.percent - a.percent;
    return a.priority - b.priority;
  });
  const largestSegment = allSegments[0];

  let bannerVariant;
  if (largestSegment.name === 'Optimal') {
    bannerVariant = 'green';
  } else if (largestDeficit?.name === 'High Risk') {
    bannerVariant = 'red';
  } else {
    bannerVariant = 'amber';
  }

  const isOrgOptimal = String(currentQuadrant || '').trim() === 'Optimal';

  const sentence1 = 'The quadrant distribution shows what proportion of the organisation currently has the conditions in place to absorb and sustain this change versus those that do not.';

  let sentence2;
  if (largestDeficit) {
    sentence2 = optimal > 0
      ? `<strong>${optimal}% of respondents are positioned in Optimal</strong>, while ${largestDeficit.percent}% sit in ${largestDeficit.name} as the largest segment that does not yet meet the conditions to absorb this change.`
      : `<strong>No respondents are positioned in Optimal</strong>, with ${largestDeficit.percent}% concentrated in ${largestDeficit.name} as the largest segment that does not yet meet the conditions to absorb this change.`;
  } else {
    sentence2 = `<strong>${optimal}% of respondents are positioned in Optimal</strong>, with no other quadrant carrying material weight in this distribution.`;
  }

  const adoptionBelow = Number.isFinite(adoptionScore) && adoptionScore < threshold;
  const sponsorshipBelow = Number.isFinite(sponsorshipScore) && sponsorshipScore < threshold;
  let barrier;
  let sentence3;
  if (isOrgOptimal) {
    // Org-level outcome is Optimal: do not imply a specific problem; close
    // with a forward-looking sustain/monitoring statement instead.
    barrier = 'sustain';
    sentence3 = 'Sustaining these conditions through ongoing sponsorship visibility and capacity monitoring is what will protect this position as the programme progresses.';
  } else if (!largestDeficit) {
    barrier = 'none';
    sentence3 = 'Sustained execution discipline on the existing sponsorship and adoption foundations is what protects this position through rollout.';
  } else if (adoptionBelow && sponsorshipBelow) {
    barrier = 'both';
    sentence3 = 'Closing that gap requires intervention on both sponsorship credibility and adoption readiness before this programme can proceed at pace.';
  } else if (sponsorshipBelow) {
    barrier = 'sponsorship';
    sentence3 = 'Closing that gap requires lifting sponsorship credibility, because managers cannot pass this change downward without visible senior backing.';
  } else if (adoptionBelow) {
    barrier = 'adoption';
    sentence3 = 'Closing that gap requires lifting adoption readiness, because capability, capacity, and change track record must improve before broader rollout.';
  } else {
    barrier = 'execution';
    sentence3 = 'Closing that gap requires sustained execution discipline on the existing sponsorship and adoption foundations to migrate the deficit segment toward Optimal.';
  }

  return {
    text: `${sentence1} ${sentence2} ${sentence3}`,
    fallback,
    optimalPct: optimal,
    largestDeficitName: largestDeficit?.name || null,
    largestDeficitPct: largestDeficit?.percent ?? null,
    largestSegmentName: largestSegment.name,
    bannerVariant,
    barrier,
  };
}

function adoptionHeaderSignal({
  managerAdoptionScore,
  threshold = 28,
}) {
  if (!Number.isFinite(managerAdoptionScore)) {
    return '<strong>Manager Adoption is unavailable, so management-layer readiness to absorb and drive adoption cannot be confirmed.</strong>';
  }
  if (managerAdoptionScore >= threshold) {
    return '<strong>The management layer is ready to absorb and drive adoption across teams.</strong>';
  }
  return '<strong>The management layer is not ready to absorb and drive adoption at the current pace.</strong>';
}

function sponsorshipHeaderSignal({
  weakerSubScore,
}) {
  if (weakerSubScore === 'Sponsorship Received') {
    return '<strong>Sponsorship Received is the weaker sub-score, so the primary risk sits with how senior leadership is supporting managers.</strong>';
  }
  if (weakerSubScore === 'Sponsorship Capacity') {
    return "<strong>Sponsorship Capacity is the weaker sub-score, so the primary risk sits with managers' ability to pass sponsorship downward to their teams.</strong>";
  }
  return '<strong>The weaker sponsorship sub-score is unavailable, so the primary sponsorship risk location cannot be confirmed.</strong>';
}

function matrixFallbackSignal(matrixRows) {
  const sustainableFunctioning = matrixRows
    .find((row) => row.loadBand === 'Sustainable')
    ?.cells?.find((cell) => cell.chainState === 'Chain Functioning')
    ?.count || 0;
  const totalManagers = matrixRows.reduce(
    (sum, row) => sum + (row.cells || []).reduce((rowSum, cell) => rowSum + (cell.count || 0), 0),
    0
  );
  const outOfPrimaryCell = Math.max(0, totalManagers - sustainableFunctioning);
  if (outOfPrimaryCell <= 0) {
    return '<strong>All managers sit in Sustainable × Chain Functioning.</strong> Intervention priority is low because risk is currently contained.';
  }
  return `<strong>${outOfPrimaryCell} managers sit outside Sustainable × Chain Functioning.</strong> Intervention priority is those managers because risk is distributed beyond the primary healthy cell.`;
}

function crossMatrixSignal(matrixRows) {
  if (!Array.isArray(matrixRows) || matrixRows.length === 0) {
    return null;
  }

  const allCells = matrixRows.flatMap((row) =>
    (row.cells || []).map((cell) => ({
      loadBand: row.loadBand,
      chainState: cell.chainState,
      count: cell.count || 0,
    }))
  );
  const totalManagers = allCells.reduce((sum, cell) => sum + cell.count, 0);
  if (totalManagers <= 0) {
    return null;
  }

  const failedBothCells = allCells.filter((cell) => cell.chainState === 'Sponsorship Failed at Both Levels');
  const failedBothTotal = failedBothCells.reduce((sum, cell) => sum + cell.count, 0);

  if (failedBothTotal > 0) {
    const topFailedBothCell = [...failedBothCells].sort((a, b) => b.count - a.count)[0];
    const sentence1 = `<strong>${failedBothTotal} manager${failedBothTotal === 1 ? '' : 's'} sit in Sponsorship Failed at Both Levels, with the largest cluster in ${topFailedBothCell.loadBand} (${topFailedBothCell.count}).</strong>`;
    const atRiskCount = allCells
      .filter((cell) => !(cell.loadBand === 'Sustainable' && cell.chainState === 'Chain Functioning'))
      .reduce((sum, cell) => sum + cell.count, 0);
    const concentration = atRiskCount > 0 ? failedBothTotal / atRiskCount : 0;
    if (concentration >= 0.6) {
      return `${sentence1} Intervention priority is immediate action on this concentrated risk cluster.`;
    }
    if (atRiskCount > 0 && atRiskCount <= Math.max(2, Math.floor(totalManagers * 0.25))) {
      return `${sentence1} Intervention priority is this masked minority cluster despite an otherwise healthy majority.`;
    }
    return `${sentence1} Intervention priority starts with this cluster because risk is distributed across multiple non-functioning cells.`;
  }

  const nonSustainableBrokenCells = allCells.filter(
    (cell) => cell.loadBand !== 'Sustainable' && cell.chainState !== 'Chain Functioning' && cell.count > 0
  );
  if (nonSustainableBrokenCells.length > 0) {
    const dominant = [...nonSustainableBrokenCells].sort((a, b) => b.count - a.count)[0];
    const sentence1 = `<strong>The dominant pressure point is ${dominant.loadBand} × ${dominant.chainState} (${dominant.count} manager${dominant.count === 1 ? '' : 's'}).</strong>`;
    const outsidePrimary = allCells
      .filter((cell) => !(cell.loadBand === 'Sustainable' && cell.chainState === 'Chain Functioning'))
      .reduce((sum, cell) => sum + cell.count, 0);
    if (outsidePrimary <= Math.max(2, Math.floor(totalManagers * 0.25))) {
      return `${sentence1} Intervention priority is targeted correction because risk is masked by an otherwise healthy majority.`;
    }
    const concentration = outsidePrimary > 0 ? dominant.count / outsidePrimary : 0;
    if (concentration >= 0.6) {
      return `${sentence1} Intervention priority is this concentrated cell before broader actions.`;
    }
    return `${sentence1} Intervention priority spans multiple non-sustainable broken-chain segments because risk is distributed.`;
  }

  return matrixFallbackSignal(matrixRows);
}

export function buildSponsorshipSectionSignals({
  header,
  subScores,
  load,
  chain,
  crossMatrix,
  teams,
}) {
  const received = Number(subScores?.received?.avg || 0);
  const capacity = Number(subScores?.capacity?.avg || 0);
  const receivedThreshold = subScores?.received?.threshold || 14;
  const capacityThreshold = subScores?.capacity?.threshold || 14;
  const subscoreText =
    received >= receivedThreshold && capacity >= capacityThreshold
      ? `Both sub-scores are above threshold. Received (${received.toFixed(1)}) and Capacity (${capacity.toFixed(1)}) indicate a stable sponsorship base.`
      : `One or both sub-scores are below threshold. Capacity (${capacity.toFixed(1)}) and Received (${received.toFixed(1)}) indicate sponsorship chain fragility that needs targeted intervention.`;

  const loadBands = Array.isArray(load?.bands) ? load.bands : [];
  const overloadedPct = loadBands.find((b) => b.name === 'Overloaded')?.percent || 0;
  const atCapacityPct = loadBands.find((b) => b.name === 'At Capacity')?.percent || 0;
  const loadText = overloadedPct > 10
    ? `Critical threshold crossed: ${pct(overloadedPct)} of managers are Overloaded. Launch risk is concentrated at the manager layer.`
    : `${pct(overloadedPct + atCapacityPct)} of managers are in At Capacity or Overloaded bands. Capacity pressure should be tracked before additional change load is introduced.`;

  const chainStates = Array.isArray(chain?.states) ? chain.states : [];
  const topState = [...chainStates].sort((a, b) => (b.percent || 0) - (a.percent || 0))[0] || null;
  const chainText = topState
    ? `${topState.name} is the dominant chain state at ${pct(topState.percent)}. This indicates where intervention pressure is currently concentrated.`
    : null;

  const matrixRows = Array.isArray(crossMatrix?.rows) ? crossMatrix.rows : [];
  const crossText = crossMatrixSignal(matrixRows);

  const teamRows = Array.isArray(teams?.rows) ? teams.rows : [];
  const highRiskTeams = teamRows.filter(
    (row) => row.chainState === 'Sponsorship Failed at Both Levels' || row.loadBand === 'Overloaded'
  );
  const teamText = `${highRiskTeams.length} teams are in critical sponsorship states. Use this list to target pre-launch enablement in sequence.`;
  const weakerSubScore = received <= capacity ? 'Sponsorship Received' : 'Sponsorship Capacity';
  const managerAdoptionScore = Number(header?.managerAdoptionScore);
  const managerThreshold = Number.isFinite(Number(header?.threshold)) ? Number(header.threshold) : 28;

  return {
    headerAdoption: {
      variant: Number.isFinite(managerAdoptionScore) && managerAdoptionScore >= managerThreshold ? 'green' : 'red',
      cardLabel: 'AVG Adoption Score · Manager Cohort',
      text: adoptionHeaderSignal({
        managerAdoptionScore,
        threshold: managerThreshold,
      }),
    },
    headerSponsorship: {
      variant: weakerSubScore === 'Sponsorship Received' ? 'amber' : 'orange',
      cardLabel: 'AVG Sponsorship Score · Manager Cohort',
      text: sponsorshipHeaderSignal({
        weakerSubScore,
      }),
    },
    subScores: {
      variant: received < receivedThreshold || capacity < capacityThreshold ? 'amber' : 'green',
      text: subscoreText,
    },
    load: {
      variant: overloadedPct >= 10 ? 'red' : 'amber',
      text: loadText,
    },
    chain: {
      variant: 'orange',
      text: chainText,
    },
    crossMatrix: {
      variant: 'red',
      text: crossText,
    },
    teams: {
      variant: 'red',
      text: teamText,
    },
  };
}
