export const READINESS_THRESHOLD = 28;

const DIMENSIONS = [
  {
    id: '1A',
    employeeLabel: 'Competence & Capability',
    managerLabel: 'Enabling Team Competence',
    employeeQuestions: ['Q1', 'Q2'],
    managerQuestions: ['MQ1', 'MQ2'],
  },
  {
    id: '1B',
    employeeLabel: 'Change Track Record',
    managerLabel: 'Team Change Track Record',
    employeeQuestions: ['Q3', 'Q4'],
    managerQuestions: ['MQ3', 'MQ4'],
  },
  {
    id: '1C',
    employeeLabel: 'Change Load / Capacity',
    managerLabel: 'Change Saturation',
    employeeQuestions: ['Q5', 'Q6'],
    managerQuestions: ['MQ5', 'MQ6'],
  },
  {
    id: '1D',
    employeeLabel: 'Manager as Enabler',
    managerLabel: 'Upward Enablement',
    employeeQuestions: ['Q7', 'Q8'],
    managerQuestions: ['MQ7', 'MQ8'],
  },
  {
    id: '2A',
    employeeLabel: 'Visible Sponsorship',
    managerLabel: 'Senior Sponsorship Visibility',
    employeeQuestions: ['Q9', 'Q10'],
    managerQuestions: ['MQ9', 'MQ10'],
  },
  {
    id: '2B',
    employeeLabel: 'Walk the Talk',
    managerLabel: 'Strategic Alignment',
    employeeQuestions: ['Q11', 'Q12'],
    managerQuestions: ['MQ11', 'MQ12'],
  },
  {
    id: '2C',
    employeeLabel: 'Honest Communication',
    managerLabel: 'Implementation Autonomy',
    employeeQuestions: ['Q13', 'Q14'],
    managerQuestions: ['MQ13', 'MQ14'],
  },
  {
    id: '2D',
    employeeLabel: 'Psychological Safety',
    managerLabel: 'Manager Wellbeing',
    employeeQuestions: ['Q15', 'Q16'],
    managerQuestions: ['MQ15', 'MQ16'],
  },
];

const EMPLOYEE_QUESTIONS = [
  {
    id: 'Q1',
    dim: '1A',
    section: 'Adoption',
    theory: 'SDT — Competence',
    text: "When changes have been rolled out here before, I've been given enough support to genuinely perform well in the new way — not just go through the motions.",
  },
  {
    id: 'Q2',
    dim: '1A',
    section: 'Adoption',
    theory: 'SP — Psychic Space',
    text: 'Right now, I feel I have the capacity — time, energy and headspace — to properly learn something new at work.',
  },
  {
    id: 'Q3',
    dim: '1B',
    section: 'Adoption',
    theory: 'SP — Institutional Trust',
    text: "Changes introduced here have generally stuck — we don't drift back to how things were before.",
  },
  {
    id: 'Q4',
    dim: '1B',
    section: 'Adoption',
    theory: 'SP — Containing Experience',
    text: "I've seen change delivered well here before — in a way that was organised and felt manageable.",
  },
  {
    id: 'Q5',
    dim: '1C',
    section: 'Adoption',
    theory: 'SP — Anxiety Flooding',
    text: "The number of changes currently underway feels manageable — I'm not overwhelmed by how much is shifting at once.",
  },
  {
    id: 'Q6',
    dim: '1C',
    section: 'Adoption',
    theory: 'SP — Carrying Capacity',
    text: 'My team has the bandwidth right now to take on something significant and new without something else having to give.',
  },
  {
    id: 'Q7',
    dim: '1D',
    section: 'Adoption',
    theory: 'SDT — Relatedness; SP — Containment',
    text: "My direct manager actively helps me work through changes — they don't just pass on information, they engage with what it means for me.",
  },
  {
    id: 'Q8',
    dim: '1D',
    section: 'Adoption',
    theory: 'SP — Projective Identification',
    text: "When I've raised concerns during a change, I've felt genuinely heard — not just managed.",
  },
  {
    id: 'Q9',
    dim: '2A',
    section: 'Sponsorship',
    theory: 'SP — Primary Task Holder',
    text: "Senior leaders here do more than announce changes — I've seen them visibly live the change themselves.",
  },
  {
    id: 'Q10',
    dim: '2A',
    section: 'Sponsorship',
    theory: 'SP — Containment Under Pressure',
    text: "When changes get hard or messy, leaders stay present and engaged — they don't go quiet or pass it down.",
  },
  {
    id: 'Q11',
    dim: '2B',
    section: 'Sponsorship',
    theory: 'SP — Splitting; SDT — Internalisation',
    text: 'My manager asks me to do things they clearly do themselves — the change applies to them as much as it does to me.',
  },
  {
    id: 'Q12',
    dim: '2B',
    section: 'Sponsorship',
    theory: 'SP — Reality Testing',
    text: 'What leaders say will happen during a change tends to match what actually happens.',
  },
  {
    id: 'Q13',
    dim: '2C',
    section: 'Sponsorship',
    theory: 'SP — Paranoid-Schizoid Position',
    text: "Leaders here are honest about the challenges a change will bring — they don't just sell the positives.",
  },
  {
    id: 'Q14',
    dim: '2C',
    section: 'Sponsorship',
    theory: 'SP — Work Group Functioning',
    text: "I've seen leaders adjust the approach when something wasn't working — they don't just push harder on the same plan.",
  },
  {
    id: 'Q15',
    dim: '2D',
    section: 'Sponsorship',
    theory: 'SP — Containment; SDT — Relatedness',
    text: "It's safe here to say when you're struggling with a change — people aren't penalised for being honest about finding it hard.",
  },
  {
    id: 'Q16',
    dim: '2D',
    section: 'Sponsorship',
    theory: 'SP — Basic Assumption Fight-Flight',
    text: 'I feel confident that if I genuinely struggled during a major transition, leadership would support me — not just performance-manage me.',
  },
];

const MANAGER_QUESTIONS = [
  {
    id: 'MQ1',
    dim: '1A',
    section: 'Adoption',
    load: false,
    theory: 'SDT — Competence Support; SP — Containment',
    text: 'I feel confident I have the information and support I need to help my team navigate this kind of change effectively.',
  },
  {
    id: 'MQ2',
    dim: '1A',
    section: 'Adoption',
    load: false,
    theory: 'SP — Role Overload',
    text: 'I have enough time and genuine capacity to actively support my team through a major change, rather than just communicating it.',
  },
  {
    id: 'MQ3',
    dim: '1B',
    section: 'Adoption',
    load: false,
    theory: 'SP — Group Learning',
    text: 'My team has successfully adopted significant changes before — and maintained them over time.',
  },
  {
    id: 'MQ4',
    dim: '1B',
    section: 'Adoption',
    load: false,
    theory: 'SP — Manager as Container',
    text: "When changes have been introduced, I've been able to maintain team performance and morale throughout the transition.",
  },
  {
    id: 'MQ5',
    dim: '1C',
    section: 'Adoption',
    load: true,
    theory: 'SP — System Overload',
    text: "The number of initiatives currently underway across my team feels manageable — we're not juggling too many simultaneous changes.",
  },
  {
    id: 'MQ6',
    dim: '1C',
    section: 'Adoption',
    load: true,
    theory: 'SP — Surplus Capacity',
    text: 'I currently have bandwidth to take on additional management responsibility that a major change would require.',
  },
  {
    id: 'MQ7',
    dim: '1D',
    section: 'Adoption',
    load: false,
    theory: 'SDT — Autonomy; SP — Role/Authority',
    text: "I feel I have enough authority and autonomy to make the decisions needed to support my team through change — I'm not constantly waiting for approval.",
  },
  {
    id: 'MQ8',
    dim: '1D',
    section: 'Adoption',
    load: false,
    theory: 'SP — Upward Containment',
    text: 'When I raise concerns about a change with senior leadership, I feel they genuinely engage with my input rather than just proceeding regardless.',
  },
  {
    id: 'MQ9',
    dim: '2A',
    section: 'Sponsorship',
    load: false,
    theory: 'SP — Primary Task Holder',
    text: "Senior leadership in this organisation are visibly modelling the changes they're asking people to make — not just advocating for them.",
  },
  {
    id: 'MQ10',
    dim: '2A',
    section: 'Sponsorship',
    load: false,
    theory: 'SP — Containment Cascade',
    text: 'When change programs hit difficulty, I can count on senior leaders to remain visible and engaged — not to step back and leave managers to manage the fallout.',
  },
  {
    id: 'MQ11',
    dim: '2B',
    section: 'Sponsorship',
    load: false,
    theory: 'SDT — Autonomy; SP — Task Clarity',
    text: "The rationale for changes I'm asked to lead is clearly explained to me — I understand the why well enough to explain it convincingly to my team.",
  },
  {
    id: 'MQ12',
    dim: '2B',
    section: 'Sponsorship',
    load: false,
    theory: 'SP — Leadership-Level Splitting',
    text: "There is alignment among senior leaders about this change — I don't receive conflicting messages or priorities from different parts of leadership.",
  },
  {
    id: 'MQ13',
    dim: '2C',
    section: 'Sponsorship',
    load: false,
    theory: 'SDT — Autonomy; SP — Role Integrity',
    text: "I'm given enough flexibility to adapt how a change is implemented for my team's specific context — it's not entirely prescribed from above.",
  },
  {
    id: 'MQ14',
    dim: '2C',
    section: 'Sponsorship',
    load: false,
    theory: 'SP — Organisational Defence',
    text: 'I feel supported by the organisation to have honest conversations with my team about the challenges of a change, rather than only presenting a positive picture.',
  },
  {
    id: 'MQ15',
    dim: '2D',
    section: 'Sponsorship',
    load: true,
    theory: 'SP — Depleted Container',
    text: "Managing my team through significant change is something I find personally sustainable — it doesn't regularly leave me feeling depleted or overwhelmed.",
  },
  {
    id: 'MQ16',
    dim: '2D',
    section: 'Sponsorship',
    load: true,
    theory: 'SDT — Competence; SP — Task Avoidance',
    text: 'I feel equipped with the skills and tools to lead my team through a major change effectively — change leadership is an area I feel confident in.',
  },
];

const THEMES = DIMENSIONS.map((d) => ({
  id: d.id,
  label: d.employeeLabel,
  managerLabel: d.managerLabel,
}));

function normalizeAudience(raw) {
  if (raw === 'manager' || raw === 'admin') return 'manager';
  return 'staff';
}

function questionSetForAudience(audience) {
  return normalizeAudience(audience) === 'manager' ? MANAGER_QUESTIONS : EMPLOYEE_QUESTIONS;
}

function answerIdForIndex(audience, index) {
  const n = index + 1;
  return normalizeAudience(audience) === 'manager' ? `MQ${n}` : `Q${n}`;
}

function scoreBandForManagerLoad(load) {
  if (load >= 16) return 'Sustainable';
  if (load >= 11) return 'Stretched';
  if (load >= 6) return 'At Capacity';
  return 'Overloaded';
}

function recommendationForQuadrant(quadrantCode) {
  if (quadrantCode === 'optimal') return 'Proceed. Conditions are strong.';
  if (quadrantCode === 'motivated_lost') return "Org ready; leaders won't carry it.";
  if (quadrantCode === 'capable_wary') return 'Leaders credible; org not ready.';
  return 'Significant redesign required.';
}

function extractAnswersFromStepPayload(step1, step2, step3, step4) {
  const answers = {
    ...(step1?.answers || {}),
    ...(step2?.answers || {}),
    ...(step3?.answers || {}),
    ...(step4?.answers || {}),
  };
  return answers;
}

function inferAudienceFromAnswers(answers, fallback = 'staff') {
  if (Object.keys(answers).some((id) => id.startsWith('MQ'))) return 'manager';
  if (Object.keys(answers).some((id) => id.startsWith('Q'))) return 'staff';
  return normalizeAudience(fallback);
}

function normalizeLikert(value) {
  if (!Number.isInteger(value)) return null;
  if (value < 1 || value > 5) return null;
  return value;
}

export function classifyQuadrant(adoption, sponsorship) {
  const adoptionHigh = adoption >= READINESS_THRESHOLD;
  const sponsorshipHigh = sponsorship >= READINESS_THRESHOLD;
  if (adoptionHigh && sponsorshipHigh) return { code: 'optimal', label: 'Optimal' };
  if (adoptionHigh && !sponsorshipHigh) return { code: 'motivated_lost', label: 'Motivated but Lost' };
  if (!adoptionHigh && sponsorshipHigh) return { code: 'capable_wary', label: 'Capable but Wary' };
  return { code: 'high_risk', label: 'High Risk' };
}

export function getQuestionsForAudience(rawAudience) {
  return questionSetForAudience(rawAudience);
}

export function computeSurveyScores({ audience, answers }) {
  const normalizedAudience = normalizeAudience(audience);
  const ids = Array.from({ length: 16 }, (_, i) => answerIdForIndex(normalizedAudience, i));
  const parsed = {};

  for (const id of ids) {
    parsed[id] = normalizeLikert(answers?.[id]);
  }

  const unanswered = ids.filter((id) => parsed[id] == null);
  if (unanswered.length > 0) {
    return {
      valid: false,
      unanswered,
      audience: normalizedAudience,
    };
  }

  const adoption = ids.slice(0, 8).reduce((sum, id) => sum + parsed[id], 0);
  const sponsorship = ids.slice(8).reduce((sum, id) => sum + parsed[id], 0);
  const quadrant = classifyQuadrant(adoption, sponsorship);

  const managerLoad =
    normalizedAudience === 'manager'
      ? parsed[answerIdForIndex('manager', 4)] +
        parsed[answerIdForIndex('manager', 5)] +
        parsed[answerIdForIndex('manager', 14)] +
        parsed[answerIdForIndex('manager', 15)]
      : null;

  const dimensions = DIMENSIONS.map((dim) => {
    const pair = normalizedAudience === 'manager' ? dim.managerQuestions : dim.employeeQuestions;
    const score = pair.reduce((sum, id) => sum + parsed[id], 0);
    return {
      id: dim.id,
      label: normalizedAudience === 'manager' ? dim.managerLabel : dim.employeeLabel,
      score,
      max: 10,
      average: score / 2,
      employeeLabel: dim.employeeLabel,
      managerLabel: dim.managerLabel,
    };
  });

  return {
    valid: true,
    audience: normalizedAudience,
    answers: parsed,
    adoption,
    sponsorship,
    quadrantCode: quadrant.code,
    quadrantLabel: quadrant.label,
    managerLoad,
    managerLoadBand: managerLoad == null ? null : scoreBandForManagerLoad(managerLoad),
    dimensions,
    recommendation: recommendationForQuadrant(quadrant.code),
  };
}

export function scoreResponseFromSteps(step1, step2, step3, step4, explicitAudience = null) {
  const answers = extractAnswersFromStepPayload(step1, step2, step3, step4);
  const audience = inferAudienceFromAnswers(answers, explicitAudience || 'staff');
  return computeSurveyScores({ audience, answers });
}

export function computeContributionStyle(step1, step2, step3, step4 = {}, audience = null) {
  const scored = scoreResponseFromSteps(step1, step2, step3, step4, audience);
  if (!scored.valid) {
    return {
      style: 'Incomplete',
      summary: { unanswered: scored.unanswered, audience: scored.audience },
      scored,
    };
  }
  const style =
    scored.audience === 'manager' && scored.managerLoadBand
      ? `${scored.quadrantLabel} · ${scored.managerLoadBand}`
      : scored.quadrantLabel;
  return {
    style,
    summary: {
      adoption: scored.adoption,
      sponsorship: scored.sponsorship,
      managerLoad: scored.managerLoad,
      quadrant: scored.quadrantLabel,
      recommendation: scored.recommendation,
    },
    scored,
  };
}

export function buildPersonalReflection(step1, step2, step3, step4, contribution) {
  const scored =
    contribution?.scored ||
    scoreResponseFromSteps(step1, step2, step3, step4, contribution?.summary?.audience || 'staff');
  if (!scored.valid) {
    return {
      incomplete: true,
      message: 'Please answer every question before viewing results.',
      unanswered: scored.unanswered,
    };
  }
  return {
    incomplete: false,
    audience: scored.audience,
    adoptionScore: scored.adoption,
    sponsorshipScore: scored.sponsorship,
    quadrant: scored.quadrantLabel,
    quadrantCode: scored.quadrantCode,
    managerLoadScore: scored.managerLoad,
    managerLoadBand: scored.managerLoadBand,
    dimensions: scored.dimensions,
    recommendation: scored.recommendation,
  };
}

export function buildActionPlanDraft(aggregates) {
  const { hotspots = [], strengths = [], tensionPairs = [], participationRate = 0, avgNps = 0 } = aggregates || {};
  return {
    thirtyDays: [
      `Share score baseline with leaders (${Math.round(participationRate * 100)}% participation).`,
      hotspots.length
        ? `Stabilise lowest dimensions first: ${hotspots.slice(0, 2).join(', ')}.`
        : 'Validate weakest dimensions with targeted manager interviews.',
      'Define role-specific actions for staff and managers before next wave.',
    ],
    sixtyDays: [
      `Track adoption and sponsorship weekly against threshold (${READINESS_THRESHOLD}/40).`,
      tensionPairs.length
        ? `Address operating tension in ${tensionPairs[0]}.`
        : 'Resolve cross-team blockers affecting sponsorship credibility.',
      strengths.length ? `Protect current strengths: ${strengths.slice(0, 2).join(', ')}.` : 'Preserve dimensions that are already above threshold.',
    ],
    ninetyDays: [
      `Run a follow-up pulse and compare deltas (legacy advocacy avg ${avgNps.toFixed(1)}/10).`,
      'Adjust rollout sequencing based on manager load distribution.',
      'Publish concrete actions taken against lowest-scoring dimensions.',
    ],
    meta: { generatedAt: new Date().toISOString() },
  };
}

export { THEMES, DIMENSIONS, EMPLOYEE_QUESTIONS, MANAGER_QUESTIONS };
