import { normalizePulseStage } from './pulseStage.js';

export const READINESS_THRESHOLD = 28;
export const SPONSORSHIP_SUBSCORE_DEFAULT_THRESHOLD = 14;
export const SPONSORSHIP_LOAD_BAND_DEFAULTS = {
  sustainableMin: 8,
  stretchedMin: 6,
  atCapacityMin: 4,
};

/**
 * Resolves an org's own Sponsorship Analysis overrides (received/capacity
 * thresholds, load-band boundaries) against the platform defaults above.
 *
 * D-008/D-016/D-017: this used to be defined only inside orgRoutes.js's
 * dashboard route and threaded through to classifySponsorshipChainState /
 * scoreBandForSponsorshipLoad there, while reportDataAssembler.js called
 * those same two functions with no config at all -- always the hardcoded
 * defaults. For any org that had actually customised these values, the
 * downloaded report and the live dashboard silently classified the exact
 * same manager responses into different load bands and chain states.
 * Single source of truth now, imported by both.
 */
export function sponsorshipConfigFromOrgSettings(settings) {
  const source =
    settings?.sponsorshipAnalysisConfig && typeof settings.sponsorshipAnalysisConfig === 'object'
      ? settings.sponsorshipAnalysisConfig
      : {};
  const receivedThreshold = Number(source.receivedThreshold ?? SPONSORSHIP_SUBSCORE_DEFAULT_THRESHOLD);
  const capacityThreshold = Number(source.capacityThreshold ?? SPONSORSHIP_SUBSCORE_DEFAULT_THRESHOLD);
  const boundaries =
    source.loadBandBoundaries && typeof source.loadBandBoundaries === 'object'
      ? source.loadBandBoundaries
      : {};
  const loadBandBoundaries = {
    sustainableMin: Number(boundaries.sustainableMin ?? SPONSORSHIP_LOAD_BAND_DEFAULTS.sustainableMin),
    stretchedMin: Number(boundaries.stretchedMin ?? SPONSORSHIP_LOAD_BAND_DEFAULTS.stretchedMin),
    atCapacityMin: Number(boundaries.atCapacityMin ?? SPONSORSHIP_LOAD_BAND_DEFAULTS.atCapacityMin),
  };
  const teamTableDisplayLimit = Number(source.teamTableDisplayLimit ?? 50);
  const aiSignalsEnabled = source.aiSignalsEnabled !== false;
  return {
    receivedThreshold,
    capacityThreshold,
    loadBandBoundaries,
    teamTableDisplayLimit:
      Number.isInteger(teamTableDisplayLimit) && teamTableDisplayLimit > 0
        ? teamTableDisplayLimit
        : 50,
    aiSignalsEnabled,
  };
}

export function sponsorshipLoadBandOrder() {
  return ['Sustainable', 'Stretched', 'At Capacity', 'Overloaded'];
}

export function sponsorshipChainStateOrder() {
  return [
    'Chain Functioning',
    'Breaking at Manager Level',
    'Managers Resilient, Under-Supported',
    'Sponsorship Failed at Both Levels',
  ];
}

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
    text: "When changes have been rolled out here before, I've been given enough support to genuinely perform well in the new way, not just go through the motions.",
  },
  {
    id: 'Q2',
    dim: '1A',
    section: 'Adoption',
    theory: 'SP — Psychic Space',
    text: 'Right now, I feel I have the capacity (time, energy and headspace) to properly learn something new at work.',
  },
  {
    id: 'Q3',
    dim: '1B',
    section: 'Adoption',
    theory: 'SP — Institutional Trust',
    text: "Changes introduced here have generally stuck; we don't drift back to how things were before.",
  },
  {
    id: 'Q4',
    dim: '1B',
    section: 'Adoption',
    theory: 'SP — Containing Experience',
    text: "I've seen change delivered well here before, in a way that was organised and felt manageable.",
  },
  {
    id: 'Q5',
    dim: '1C',
    section: 'Adoption',
    theory: 'SP — Anxiety Flooding',
    text: "The number of changes currently underway feels manageable; I'm not overwhelmed by how much is shifting at once.",
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
    text: "My direct manager actively helps me work through changes; they don't just pass on information, they engage with what it means for me.",
  },
  {
    id: 'Q8',
    dim: '1D',
    section: 'Adoption',
    theory: 'SP — Projective Identification',
    text: "When I've raised concerns during a change, I've felt genuinely heard, not just managed.",
  },
  {
    id: 'Q9',
    dim: '2A',
    section: 'Sponsorship',
    theory: 'SP — Primary Task Holder',
    text: "Senior leaders here do more than announce changes; I've seen them visibly live the change themselves.",
  },
  {
    id: 'Q10',
    dim: '2A',
    section: 'Sponsorship',
    theory: 'SP — Containment Under Pressure',
    text: "When changes get hard or messy, leaders stay present and engaged; they don't go quiet or pass it down.",
  },
  {
    id: 'Q11',
    dim: '2B',
    section: 'Sponsorship',
    theory: 'SP — Splitting; SDT — Internalisation',
    text: 'My manager asks me to do things they clearly do themselves; change applies to them as much as it does to me.',
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
    text: "Leaders here are honest about the challenges a change will bring; they don't just sell the positives.",
  },
  {
    id: 'Q14',
    dim: '2C',
    section: 'Sponsorship',
    theory: 'SP — Work Group Functioning',
    text: "I've seen leaders adjust the approach when something wasn't working; they don't just push harder on the same plan.",
  },
  {
    id: 'Q15',
    dim: '2D',
    section: 'Sponsorship',
    theory: 'SP — Containment; SDT — Relatedness',
    text: "It's safe here to say when you're struggling with a change; people aren't penalised for being honest about finding it hard.",
  },
  {
    id: 'Q16',
    dim: '2D',
    section: 'Sponsorship',
    theory: 'SP — Basic Assumption Fight-Flight',
    text: 'I feel confident that if I genuinely struggled during a major transition, leadership would support me; not just performance-manage me.',
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
    text: 'My team has successfully adopted significant changes before and maintained them over time.',
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
    text: "The number of initiatives currently underway across my team feels manageable; we're not juggling too many simultaneous changes.",
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
    text: "I feel I have enough authority and autonomy to make the decisions needed to support my team through change; I'm not constantly waiting for approval.",
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
    text: "Senior leadership in this organisation are visibly modelling the changes they're asking people to make, not just advocating for them.",
  },
  {
    id: 'MQ10',
    dim: '2A',
    section: 'Sponsorship',
    load: false,
    theory: 'SP — Containment Cascade',
    text: 'When change programs hit difficulty, I can count on senior leaders to remain visible and engaged; not to step back and leave managers to manage the fallout.',
  },
  {
    id: 'MQ11',
    dim: '2B',
    section: 'Sponsorship',
    load: false,
    theory: 'SDT — Autonomy; SP — Task Clarity',
    text: "The rationale for changes I'm asked to lead is clearly explained to me; I understand the why well enough to explain it convincingly to my team.",
  },
  {
    id: 'MQ12',
    dim: '2B',
    section: 'Sponsorship',
    load: false,
    theory: 'SP — Leadership-Level Splitting',
    text: "There is alignment among senior leaders about this change; I don't receive conflicting messages or priorities from different parts of leadership.",
  },
  {
    id: 'MQ13',
    dim: '2C',
    section: 'Sponsorship',
    load: false,
    theory: 'SDT — Autonomy; SP — Role Integrity',
    text: "I'm given enough flexibility to adapt how a change is implemented for my team's specific context; it's not entirely prescribed from above.",
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
    text: "Managing my team through significant change is something I find personally sustainable; it doesn't regularly leave me feeling depleted or overwhelmed.",
  },
  {
    id: 'MQ16',
    dim: '2D',
    section: 'Sponsorship',
    load: true,
    theory: 'SDT — Competence; SP — Task Avoidance',
    text: 'I feel equipped with the skills and tools to lead my team through a major change effectively; change leadership is an area I feel confident in.',
  },
];

const THEMES = DIMENSIONS.map((d) => ({
  id: d.id,
  label: d.employeeLabel,
  managerLabel: d.managerLabel,
}));

const EMPLOYEE_STAGE_TEXT = {
  mid: {
    Q1: 'During this change, I am receiving enough support to genuinely perform well in the new way, not just go through the motions.',
    Q2: 'Right now, while this change is underway, I feel I have the capacity (time, energy and headspace) to keep learning and adapting.',
    Q3: "So far in this change, the new ways of working are taking hold; we're not drifting back to how things were.",
    Q4: 'This change is being delivered in a way that feels organised and manageable.',
    Q5: 'The number of things shifting at once during this change feels manageable; I am not overwhelmed.',
    Q6: 'My team is managing its workload alongside this change; we are not struggling to keep up with both.',
    Q7: 'My direct manager is actively helping me work through this change; they engage with what it means for me, not just pass on information.',
    Q8: 'When I have raised concerns during this change, I have felt genuinely heard, not just managed.',
    Q9: 'Senior leaders are doing more than announcing this change; I can see them visibly living it themselves.',
    Q10: 'Now that this change is underway, leaders are staying present and engaged; they are not going quiet or passing it down when it gets difficult.',
    Q11: 'My manager is asking me to do things they are clearly doing themselves; this change applies to them as much as it does to me.',
    Q12: 'What leaders said would happen in this change is broadly matching what is actually happening.',
    Q13: 'Leaders are being honest about the challenges this change is bringing; they are not just selling the positives.',
    Q14: 'I have seen leaders adjust the approach during this change when something has not been working; they are not just pushing harder on the same plan.',
    Q15: 'It feels safe to say I am struggling with this change; I do not feel I will be penalised for being honest about finding it hard.',
    Q16: 'I feel confident that my struggles during this change are being met with genuine support, not just performance management.',
  },
  post: {
    Q1: 'During this change, I was given enough support to genuinely perform well in the new way, not just go through the motions.',
    Q2: 'Throughout this change, I felt I had enough capacity (time, energy and headspace) to properly learn and adapt.',
    Q3: 'The changes introduced through this programme have stuck; we have not drifted back to how things were before.',
    Q4: 'This change was delivered in a way that felt organised and manageable throughout.',
    Q5: 'The pace and volume of change during this programme felt manageable; I was not overwhelmed by how much was shifting at once.',
    Q6: 'My team maintained enough bandwidth throughout this change to absorb it without other priorities seriously suffering.',
    Q7: 'My direct manager actively helped me work through this change; they engaged with what it meant for me, not just passed on information.',
    Q8: 'When I raised concerns during this change, I felt genuinely heard; not just managed.',
    Q9: 'Senior leaders did more than announce this change; I saw them visibly living it themselves throughout.',
    Q10: 'When this change got hard or messy, leaders stayed present and engaged; they did not go quiet or pass it down.',
    Q11: 'My manager asked me to do things they clearly did themselves; this change applied to them as much as it did to me.',
    Q12: 'What leaders said would happen in this change matched what actually happened.',
    Q13: 'Leaders were honest about the challenges this change brought; they did not just sell the positives.',
    Q14: 'I saw leaders adjust the approach during this change when something was not working; they did not just push harder on the same plan.',
    Q15: 'It was safe to say when I was struggling with this change; I did not feel penalised for being honest about finding it hard.',
    Q16: 'When I struggled during this change, I felt genuinely supported by leadership; not just performance managed.',
  },
};

const MANAGER_STAGE_TEXT = {
  mid: {
    MQ1: 'I feel confident I have the information and support I need to help my team navigate this change as it unfolds.',
    MQ2: 'I have enough time and genuine capacity right now to actively support my team through this change, rather than just communicating it.',
    MQ3: 'My team is successfully adopting this change; the new ways of working are beginning to take hold.',
    MQ4: 'During this change, I have been able to maintain team performance and morale throughout the transition so far.',
    MQ5: 'The number of things my team is managing simultaneously during this change feels manageable; we are not stretched too thin.',
    MQ6: 'I currently have enough bandwidth to manage the additional leadership responsibility this change requires.',
    MQ7: 'I feel I have enough authority and autonomy to make the decisions needed to support my team through this change; I am not constantly waiting for approval.',
    MQ8: 'When I raise concerns about this change with senior leadership, I feel they genuinely engage with my input rather than just proceeding regardless.',
    MQ9: 'Senior leadership in this organisation are visibly modelling this change, not just advocating for it.',
    MQ10: 'Now that this programme has hit difficulty, senior leaders are remaining visible and engaged; they are not stepping back and leaving managers to manage the fallout.',
    MQ11: 'The rationale for this change has been clearly explained to me; I understand the why well enough to explain it convincingly to my team.',
    MQ12: 'There is alignment among senior leaders about this change; I am not receiving conflicting messages or priorities from different parts of leadership.',
    MQ13: 'I am being given enough flexibility to adapt how this change is implemented for my team’s specific context; it is not entirely prescribed from above.',
    MQ14: 'I feel supported by the organisation to have honest conversations with my team about the challenges of this change, rather than only presenting a positive picture.',
    MQ15: 'Managing my team through this change is something I am finding personally sustainable; it is not regularly leaving me feeling depleted or overwhelmed.',
    MQ16: 'I feel equipped with the skills and tools to lead my team through this change effectively; I feel confident in my ability to do so.',
  },
  post: {
    MQ1: 'I felt confident throughout this change that I had the information and support I needed to help my team navigate it effectively.',
    MQ2: 'I had enough time and genuine capacity throughout this change to actively support my team, rather than just communicate it.',
    MQ3: 'My team successfully adopted this change, and the new ways of working have been maintained over time.',
    MQ4: 'During this change, I was able to maintain team performance and morale throughout the transition.',
    MQ5: 'The number of things my team was managing simultaneously during this change felt manageable; we were not stretched too thin.',
    MQ6: 'I had enough bandwidth throughout this change to manage the additional leadership responsibility it required.',
    MQ7: 'I felt I had enough authority and autonomy to make the decisions needed to support my team through this change; I was not constantly waiting for approval.',
    MQ8: 'When I raised concerns about this change with senior leadership, I felt they genuinely engaged with my input rather than just proceeding regardless.',
    MQ9: 'Senior leadership visibly modelled this change throughout; they did not just advocate for it.',
    MQ10: 'When this programme hit difficulty, senior leaders remained visible and engaged; they did not step back and leave managers to manage the fallout.',
    MQ11: 'The rationale for this change was clearly explained to me; I understood the why well enough to explain it convincingly to my team.',
    MQ12: 'There was alignment among senior leaders about this change; I did not receive conflicting messages or priorities from different parts of leadership.',
    MQ13: 'I was given enough flexibility to adapt how this change was implemented for my team’s specific context; it was not entirely prescribed from above.',
    MQ14: 'I felt supported by the organisation to have honest conversations with my team about the challenges of this change, rather than only presenting a positive picture.',
    MQ15: 'Managing my team through this change was something I found personally sustainable; it did not regularly leave me feeling depleted or overwhelmed.',
    MQ16: 'I felt equipped with the skills and tools to lead my team through this change effectively; change leadership is an area I felt confident in.',
  },
};

const STAGE_COPY = {
  pre: {
    employeeIntro:
      'Before this change starts, we want to understand how ready the organisation is. Your honest responses are anonymous and help identify where support is needed.',
    managerIntro:
      'Before this change starts, we want to understand manager readiness and support conditions. Your responses are anonymous and used in aggregate only.',
    transition:
      'You have completed the first section. The next set of questions focuses on leadership sponsorship around this change.',
    reflection:
      'Thank you for completing the pre-change survey. This baseline will be used to compare progress at mid and post stages.',
  },
  mid: {
    employeeIntro:
      'This change is now underway, and we want to understand how it is going for you. Your honest responses are anonymous and will help the organisation focus support where needed.',
    managerIntro:
      'This change is now underway. We want to understand how you are experiencing it as a manager, where pressure is highest, and what support is most useful right now.',
    transition:
      'You have completed the first section. The next set of questions moves from your own experience of this change so far to your experience of leadership and sponsorship around it.',
    reflection:
      'Thank you for completing the mid-change survey. Your responses help track what is improving and what still needs attention while delivery is live.',
  },
  post: {
    employeeIntro:
      'This change programme has now concluded. We want to understand how it went for you: what worked, what was hard, and what the experience has left you with.',
    managerIntro:
      'This change programme has now concluded. We want to understand how it went from your perspective as a manager and what should be different next time.',
    transition:
      'You have completed the first section. The next set of questions moves from your experience of adopting this change to your reflections on leadership and sponsorship around it.',
    reflection:
      'Thank you for completing the post-change survey. Your reflections will help the organisation learn from this programme and prepare better for the next one.',
  },
};

const EMPLOYEE_QUESTION_SET_TRANSITION =
  'These set of questions will enable us to better understand how change is supported within your organisation. Please rate each statement from 1 to 5, where 1 = Strongly Disagree and 5 = Strongly Agree.';
const MANAGER_QUESTION_SET_TRANSITION =
  'As a manager, your perspective is invaluable. These questions explore your experience of leading through change and the conditions that enable you to do so effectively. Please rate each statement from 1 to 5, where 1 = Strongly Disagree and 5 = Strongly Agree.';

function normalizeAudience(raw) {
  if (raw === 'manager' || raw === 'admin') return 'manager';
  return 'staff';
}

function questionSetForAudience(audience) {
  return normalizeAudience(audience) === 'manager' ? MANAGER_QUESTIONS : EMPLOYEE_QUESTIONS;
}

function stageTextForAudience(audience, stage) {
  if (normalizeAudience(audience) === 'manager') {
    return MANAGER_STAGE_TEXT[stage] || null;
  }
  return EMPLOYEE_STAGE_TEXT[stage] || null;
}

function questionsForAudienceAndStage(audience, stage) {
  const normalizedStage = normalizePulseStage(stage);
  const stageText = stageTextForAudience(audience, normalizedStage);
  const source = questionSetForAudience(audience);
  if (!stageText) return source;
  return source.map((question) => ({
    ...question,
    text: stageText[question.id] || question.text,
  }));
}

function surveyCopyForAudienceAndStage(audience, stage) {
  const normalizedStage = normalizePulseStage(stage);
  const copy = STAGE_COPY[normalizedStage] || STAGE_COPY.pre;
  const normalizedAudience = normalizeAudience(audience);
  return {
    stage: normalizedStage,
    audience: normalizedAudience,
    intro:
      normalizedAudience === 'manager'
        ? copy.managerIntro
        : copy.employeeIntro,
    transition:
      normalizedAudience === 'manager'
        ? MANAGER_QUESTION_SET_TRANSITION
        : EMPLOYEE_QUESTION_SET_TRANSITION,
    reflection: copy.reflection,
  };
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

export function scoreBandForSponsorshipLoad(load, boundaries = SPONSORSHIP_LOAD_BAND_DEFAULTS) {
  const sustainableMin = Number(boundaries?.sustainableMin ?? SPONSORSHIP_LOAD_BAND_DEFAULTS.sustainableMin);
  const stretchedMin = Number(boundaries?.stretchedMin ?? SPONSORSHIP_LOAD_BAND_DEFAULTS.stretchedMin);
  const atCapacityMin = Number(boundaries?.atCapacityMin ?? SPONSORSHIP_LOAD_BAND_DEFAULTS.atCapacityMin);
  if (load >= sustainableMin) return 'Sustainable';
  if (load >= stretchedMin) return 'Stretched';
  if (load >= atCapacityMin) return 'At Capacity';
  return 'Overloaded';
}

export function classifySponsorshipChainState(
  receivedScore,
  capacityScore,
  thresholds = {
    receivedThreshold: SPONSORSHIP_SUBSCORE_DEFAULT_THRESHOLD,
    capacityThreshold: SPONSORSHIP_SUBSCORE_DEFAULT_THRESHOLD,
  }
) {
  const receivedThreshold = Number(
    thresholds?.receivedThreshold ?? SPONSORSHIP_SUBSCORE_DEFAULT_THRESHOLD
  );
  const capacityThreshold = Number(
    thresholds?.capacityThreshold ?? SPONSORSHIP_SUBSCORE_DEFAULT_THRESHOLD
  );
  const receivedHigh = receivedScore >= receivedThreshold;
  const capacityHigh = capacityScore >= capacityThreshold;
  if (receivedHigh && capacityHigh) return 'Chain Functioning';
  if (receivedHigh && !capacityHigh) return 'Breaking at Manager Level';
  if (!receivedHigh && capacityHigh) return 'Managers Resilient, Under-Supported';
  return 'Sponsorship Failed at Both Levels';
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

export function getQuestionsForAudience(rawAudience, rawStage = 'pre') {
  return questionsForAudienceAndStage(rawAudience, rawStage);
}

export function getSurveyCopyForAudience(rawAudience, rawStage = 'pre') {
  return surveyCopyForAudienceAndStage(rawAudience, rawStage);
}

export function computeSurveyScores({ audience, answers, stage = 'pre' }) {
  const normalizedAudience = normalizeAudience(audience);
  const normalizedStage = normalizePulseStage(stage);
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
      stage: normalizedStage,
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
  const sponsorshipReceivedScore =
    normalizedAudience === 'manager'
      ? parsed[answerIdForIndex('manager', 8)] +
        parsed[answerIdForIndex('manager', 9)] +
        parsed[answerIdForIndex('manager', 10)] +
        parsed[answerIdForIndex('manager', 11)]
      : null;
  const sponsorshipCapacityScore =
    normalizedAudience === 'manager'
      ? parsed[answerIdForIndex('manager', 12)] +
        parsed[answerIdForIndex('manager', 13)] +
        parsed[answerIdForIndex('manager', 14)] +
        parsed[answerIdForIndex('manager', 15)]
      : null;
  const sponsorshipLoadScore =
    normalizedAudience === 'manager'
      ? parsed[answerIdForIndex('manager', 14)] + parsed[answerIdForIndex('manager', 15)]
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
    stage: normalizedStage,
    answers: parsed,
    adoption,
    sponsorship,
    quadrantCode: quadrant.code,
    quadrantLabel: quadrant.label,
    managerLoad,
    managerLoadBand: managerLoad == null ? null : scoreBandForManagerLoad(managerLoad),
    sponsorshipReceivedScore,
    sponsorshipCapacityScore,
    sponsorshipLoadScore,
    sponsorshipLoadBand:
      sponsorshipLoadScore == null ? null : scoreBandForSponsorshipLoad(sponsorshipLoadScore),
    sponsorshipChainState:
      sponsorshipReceivedScore == null || sponsorshipCapacityScore == null
        ? null
        : classifySponsorshipChainState(sponsorshipReceivedScore, sponsorshipCapacityScore),
    dimensions,
    recommendation: recommendationForQuadrant(quadrant.code),
  };
}

export function scoreResponseFromSteps(step1, step2, step3, step4, explicitAudience = null, stage = 'pre') {
  const answers = extractAnswersFromStepPayload(step1, step2, step3, step4);
  const audience = inferAudienceFromAnswers(answers, explicitAudience || 'staff');
  return computeSurveyScores({ audience, answers, stage });
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
    stage: scored.stage,
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
