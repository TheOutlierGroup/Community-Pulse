import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAdoptionScoreCardSignal,
  buildLikelihoodWhatThisMeansSignal,
  buildQuadrantExplanationSignal,
  normalizeAssessmentStageLabel,
  SCORE_CARD_SIGNAL_PROMPTS,
  buildSponsorshipSectionSignals,
  buildSponsorshipScoreCardSignal,
  buildTopScoreCardSignals,
  buildDimensionFloorAlerts,
  buildSponsorshipDecliningAlert,
  buildTeamOutlierAlerts,
  buildThresholdCrossingAlerts,
  calculateLargestRemainderPercentages,
  headlineForVerdict,
  prioritizeAndCapAlerts,
  verdictForScores,
} from './pulseDashboardMetrics.js';

test('score card prompt templates are spec-locked', () => {
  assert.equal(
    SCORE_CARD_SIGNAL_PROMPTS.adoption.system,
    'You are a change readiness analyst writing a single descriptive sentence for a dashboard score card. Maximum 1 sentence. No hedging. No classification labels. Do not use the words "High Risk", "Optimal", "Capable Wary", or "Motivated but Lost".'
  );
  assert.ok(SCORE_CARD_SIGNAL_PROMPTS.adoption.user.includes('{{client_name}}'));
  assert.ok(SCORE_CARD_SIGNAL_PROMPTS.adoption.user.includes('{{assessment_stage}}'));
  assert.ok(SCORE_CARD_SIGNAL_PROMPTS.adoption.user.includes('{{respondent_count}}'));
  assert.ok(SCORE_CARD_SIGNAL_PROMPTS.adoption.user.includes('{{adoption_score}}'));
  assert.ok(SCORE_CARD_SIGNAL_PROMPTS.adoption.user.includes('{{modal_quadrant}}'));
  assert.equal(
    SCORE_CARD_SIGNAL_PROMPTS.adoption.fallback,
    'With the majority of respondents sitting within the {{modal_quadrant}} quadrant, this score reflects how employees and managers collectively experience their readiness to absorb this change.'
  );
  assert.equal(
    SCORE_CARD_SIGNAL_PROMPTS.sponsorship.system,
    'You are a change readiness analyst writing a single descriptive sentence for a dashboard score card. Maximum 1 sentence. No hedging. No classification labels. Do not use the words "High Risk", "Optimal", "Capable Wary", or "Motivated but Lost".'
  );
  assert.ok(SCORE_CARD_SIGNAL_PROMPTS.sponsorship.user.includes('{{client_name}}'));
  assert.ok(SCORE_CARD_SIGNAL_PROMPTS.sponsorship.user.includes('{{assessment_stage}}'));
  assert.ok(SCORE_CARD_SIGNAL_PROMPTS.sponsorship.user.includes('{{respondent_count}}'));
  assert.ok(SCORE_CARD_SIGNAL_PROMPTS.sponsorship.user.includes('{{sponsorship_score}}'));
  assert.ok(SCORE_CARD_SIGNAL_PROMPTS.sponsorship.user.includes('{{modal_quadrant}}'));
  assert.equal(
    SCORE_CARD_SIGNAL_PROMPTS.sponsorship.fallback,
    'With the majority of respondents sitting within the {{modal_quadrant}} quadrant, this score reflects how employees and managers collectively experience the credibility and visibility of leadership sponsorship.'
  );
  assert.equal(
    SCORE_CARD_SIGNAL_PROMPTS.likelihood.fallback,
    'The quadrant distribution shows how individuals are spread across all four readiness states. Review the proportion outside Optimal to determine the scale and nature of intervention required.'
  );
  assert.equal(
    SCORE_CARD_SIGNAL_PROMPTS.managerCohortAverages.system,
    'You are a change readiness analyst writing a concise signal banner for a practitioner dashboard. Your output will be rendered as italicised prose. Write in plain English. Be direct and factual. Do not hedge. Do not use bullet points. Maximum 2 sentences. Wrap the single most important finding in <strong> tags.'
  );
  assert.ok(SCORE_CARD_SIGNAL_PROMPTS.managerCohortAverages.user.includes('{{client_name}}'));
  assert.ok(SCORE_CARD_SIGNAL_PROMPTS.managerCohortAverages.user.includes('{{assessment_stage}}'));
  assert.ok(SCORE_CARD_SIGNAL_PROMPTS.managerCohortAverages.user.includes('{{manager_count}}'));
  assert.ok(SCORE_CARD_SIGNAL_PROMPTS.managerCohortAverages.user.includes('{{adoption_score}}'));
  assert.ok(SCORE_CARD_SIGNAL_PROMPTS.managerCohortAverages.user.includes('{{adoption_threshold_status}}'));
  assert.ok(SCORE_CARD_SIGNAL_PROMPTS.managerCohortAverages.user.includes('{{sponsorship_score}}'));
  assert.ok(SCORE_CARD_SIGNAL_PROMPTS.managerCohortAverages.user.includes('{{sponsorship_threshold_status}}'));
  assert.ok(SCORE_CARD_SIGNAL_PROMPTS.managerCohortAverages.user.includes('{{received_score}}'));
  assert.ok(SCORE_CARD_SIGNAL_PROMPTS.managerCohortAverages.user.includes('{{capacity_score}}'));
  assert.ok(SCORE_CARD_SIGNAL_PROMPTS.managerCohortAverages.user.includes('{{weaker_sub_score}}'));
  assert.equal(
    SCORE_CARD_SIGNAL_PROMPTS.managerCohortAverages.fallback,
    'Review both average scores relative to the 28-point threshold. Where either score is below threshold, identify whether the deficit sits with adoption conditions or sponsorship credibility before determining the intervention approach.'
  );
  assert.equal(
    SCORE_CARD_SIGNAL_PROMPTS.teamChainBreakdown.system,
    'You are a change readiness analyst writing a concise signal banner for a practitioner dashboard. Your output will be rendered as italicised prose. Write in plain English. Be direct and factual. Do not hedge. Do not use bullet points. Maximum 2 sentences. Wrap the single most important finding in <strong> tags. If any team is simultaneously in Sponsorship Failed at Both Levels and At Capacity or Overloaded, this must be the primary finding.'
  );
  assert.ok(SCORE_CARD_SIGNAL_PROMPTS.teamChainBreakdown.user.includes('{{client_name}}'));
  assert.ok(SCORE_CARD_SIGNAL_PROMPTS.teamChainBreakdown.user.includes('{{assessment_stage}}'));
  assert.ok(SCORE_CARD_SIGNAL_PROMPTS.teamChainBreakdown.user.includes('{{total_teams}}'));
  assert.ok(SCORE_CARD_SIGNAL_PROMPTS.teamChainBreakdown.user.includes('{{teams_shown}}'));
  assert.ok(SCORE_CARD_SIGNAL_PROMPTS.teamChainBreakdown.user.includes('{{team_list}}'));
  assert.ok(SCORE_CARD_SIGNAL_PROMPTS.teamChainBreakdown.user.includes('{{failed_both_count}}'));
  assert.ok(SCORE_CARD_SIGNAL_PROMPTS.teamChainBreakdown.user.includes('{{functioning_count}}'));
  assert.ok(SCORE_CARD_SIGNAL_PROMPTS.teamChainBreakdown.user.includes('{{highest_urgency_team}}'));
  assert.equal(
    SCORE_CARD_SIGNAL_PROMPTS.teamChainBreakdown.fallback,
    'Review the team list for any team simultaneously showing Sponsorship Failed at Both Levels and At Capacity or Overloaded — this combination represents the highest urgency intervention target and should be addressed before any other pre-launch enablement activity.'
  );
});

test('largest remainder percentages always sum to 100', () => {
  const percentages = calculateLargestRemainderPercentages([1, 1, 1]);
  assert.equal(percentages.reduce((sum, value) => sum + value, 0), 100);
  assert.deepEqual(percentages, [34, 33, 33]);
});

test('largest remainder percentages return zeros when total is zero', () => {
  const percentages = calculateLargestRemainderPercentages([0, 0, 0, 0]);
  assert.deepEqual(percentages, [0, 0, 0, 0]);
});

test('threshold crossing alerts only fire on crossing events', () => {
  const alerts = buildThresholdCrossingAlerts({
    currentAdoption: 29,
    previousAdoption: 27,
    currentSponsorship: 26,
    previousSponsorship: 29,
    threshold: 28,
  });
  assert.equal(alerts.length, 2);
  assert.equal(alerts[0].title, 'Adoption threshold crossed upward');
  assert.equal(alerts[1].title, 'Sponsorship threshold crossed downward');
});

test('alert prioritization caps deterministically', () => {
  const source = [
    { level: 'info', title: 'B' },
    { level: 'warning', title: 'B' },
    { level: 'critical', title: 'A' },
    { level: 'info', title: 'A' },
    { level: 'warning', title: 'A' },
    { level: 'critical', title: 'B' },
  ];
  const result = prioritizeAndCapAlerts(source, 5);
  assert.equal(result.alerts.length, 5);
  assert.equal(result.overflowCount, 1);
  assert.deepEqual(
    result.alerts.map((a) => `${a.level}:${a.title}`),
    ['critical:A', 'critical:B', 'warning:A', 'warning:B', 'info:A']
  );
});

test('verdict uses threshold for launch state', () => {
  assert.equal(verdictForScores(30, 30), 'cleared');
  assert.equal(verdictForScores(30, 27), 'not_cleared');
  assert.equal(verdictForScores(null, 30), 'insufficient_data');
});

test('headline uses title case matching doc', () => {
  assert.equal(headlineForVerdict('cleared'), 'Cleared for Launch');
  assert.equal(headlineForVerdict('not_cleared'), 'Not Cleared for Launch');
  assert.equal(headlineForVerdict('insufficient_data'), 'Insufficient data for launch verdict');
});

test('sponsorship declining alert fires when drop exceeds 1 point', () => {
  const alerts = buildSponsorshipDecliningAlert({
    currentSponsorship: 26,
    previousSponsorship: 27.5,
  });
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].level, 'warning');
  assert.equal(alerts[0].title, 'Sponsorship declining');
});

test('sponsorship declining alert does not fire for drop of exactly 1 point', () => {
  const alerts = buildSponsorshipDecliningAlert({
    currentSponsorship: 27,
    previousSponsorship: 28,
  });
  assert.equal(alerts.length, 0);
});

test('sponsorship declining alert does not fire when either score is null', () => {
  assert.equal(buildSponsorshipDecliningAlert({ currentSponsorship: null, previousSponsorship: 28 }).length, 0);
  assert.equal(buildSponsorshipDecliningAlert({ currentSponsorship: 26, previousSponsorship: null }).length, 0);
});

test('dimension floor alerts fire for any dimension below 2.5', () => {
  const dimensions = [
    { id: '1A', label: 'Competence & Capability', managerLabel: 'Enabling Team Competence', energyAvg: 2.4, frictionAvg: 3.0 },
    { id: '1B', label: 'Change Track Record', managerLabel: 'Team Change Track Record', energyAvg: 3.5, frictionAvg: 2.3 },
    { id: '1C', label: 'Change Load / Capacity', managerLabel: 'Change Saturation', energyAvg: 3.0, frictionAvg: 3.5 },
  ];
  const alerts = buildDimensionFloorAlerts({ dimensions });
  assert.equal(alerts.length, 2);
  assert.equal(alerts[0].title, 'Dimension floor: Competence & Capability');
  assert.equal(alerts[1].title, 'Dimension floor: Team Change Track Record');
});

test('dimension floor alerts do not fire for averages at or above 2.5', () => {
  const dimensions = [
    { id: '1A', label: 'Competence & Capability', managerLabel: 'Enabling Team Competence', energyAvg: 2.5, frictionAvg: 2.5 },
  ];
  const alerts = buildDimensionFloorAlerts({ dimensions });
  assert.equal(alerts.length, 0);
});

test('team outlier alerts fire when team score is more than 8 pts below org avg', () => {
  const byManager = [
    { managerName: 'Alice', managerEmail: 'alice@co', adoptionScore: 20, sponsorshipScore: 30, directReportCompletedCount: 6 },
    { managerName: 'Bob', managerEmail: 'bob@co', adoptionScore: 30, sponsorshipScore: 30, directReportCompletedCount: 6 },
  ];
  const alerts = buildTeamOutlierAlerts({ byManager, orgAdoptionScore: 30, orgSponsorshipScore: 30 });
  assert.equal(alerts.length, 1);
  assert.ok(alerts[0].title.includes('Alice'));
  assert.ok(alerts[0].body.includes('adoption'));
});

test('team outlier alerts respect anonymity threshold of 5 responses', () => {
  const byManager = [
    { managerName: 'Alice', managerEmail: 'alice@co', adoptionScore: 10, sponsorshipScore: 10, directReportCompletedCount: 4 },
  ];
  const alerts = buildTeamOutlierAlerts({ byManager, orgAdoptionScore: 30, orgSponsorshipScore: 30 });
  assert.equal(alerts.length, 0);
});

test('team outlier alerts do not fire when gap is exactly 8 pts', () => {
  const byManager = [
    { managerName: 'Alice', managerEmail: 'alice@co', adoptionScore: 22, sponsorshipScore: 30, directReportCompletedCount: 5 },
  ];
  const alerts = buildTeamOutlierAlerts({ byManager, orgAdoptionScore: 30, orgSponsorshipScore: 30 });
  assert.equal(alerts.length, 0);
});

test('dimension floor alerts skip null averages', () => {
  const dimensions = [
    { id: '1A', label: 'Competence & Capability', managerLabel: 'Enabling Team Competence', energyAvg: null, frictionAvg: null },
  ];
  const alerts = buildDimensionFloorAlerts({ dimensions });
  assert.equal(alerts.length, 0);
});

test('sponsorship section signals are derived from computed metrics', () => {
  const signals = buildSponsorshipSectionSignals({
    header: {
      clientName: 'Nexora Consulting Group',
      stage: 'pre',
      threshold: 28,
      managerCount: 9,
      managerAdoptionScore: 27.9,
      managerSponsorshipScore: 27.6,
    },
    subScores: {
      received: { avg: 13.2, threshold: 14 },
      capacity: { avg: 11.8, threshold: 14 },
    },
    load: {
      bands: [
        { name: 'Sustainable', percent: 18 },
        { name: 'Stretched', percent: 41 },
        { name: 'At Capacity', percent: 28 },
        { name: 'Overloaded', percent: 13 },
      ],
    },
    chain: {
      states: [
        { name: 'Chain Functioning', percent: 22 },
        { name: 'Breaking at Manager Level', percent: 18 },
        { name: 'Managers Resilient, Under-Supported', percent: 31 },
        { name: 'Sponsorship Failed at Both Levels', percent: 29 },
      ],
    },
    crossMatrix: {
      rows: [
        {
          loadBand: 'Overloaded',
          cells: [
            { chainState: 'Chain Functioning', count: 0 },
            { chainState: 'Breaking at Manager Level', count: 1 },
            { chainState: 'Managers Resilient, Under-Supported', count: 3 },
            { chainState: 'Sponsorship Failed at Both Levels', count: 4 },
          ],
        },
      ],
    },
    teams: {
      rows: [
        { teamName: 'Sales & Revenue', chainState: 'Sponsorship Failed at Both Levels', loadBand: 'Overloaded', receivedAvg: 2.5, capacityAvg: 2.4 },
        { teamName: 'Innovation', chainState: 'Breaking at Manager Level', loadBand: 'Stretched', receivedAvg: 3.2, capacityAvg: 3.1 },
      ],
      shownRows: [
        { teamName: 'Sales & Revenue', chainState: 'Sponsorship Failed at Both Levels', loadBand: 'Overloaded', receivedAvg: 2.5, capacityAvg: 2.4 },
      ],
    },
  });
  assert.equal(signals.load.variant, 'red');
  assert.equal(signals.crossMatrix.variant, 'red');
  assert.equal(signals.teams.variant, 'red');
  assert.ok(signals.subScores.text.includes('<strong>'));
  assert.equal(signals.subScores.fallback, SCORE_CARD_SIGNAL_PROMPTS.managerCohortAverages.fallback);
  assert.equal(signals.subScores.promptContext.clientName, 'Nexora Consulting Group');
  assert.equal(signals.subScores.promptContext.assessmentStage, 'Pre-Change');
  assert.equal(signals.subScores.promptContext.managerCount, 9);
  assert.equal(signals.subScores.promptContext.weakerSubScore, 'Capacity');
  assert.ok(signals.teams.text.includes('Sales & Revenue'));
  assert.equal(signals.teams.fallback, SCORE_CARD_SIGNAL_PROMPTS.teamChainBreakdown.fallback);
  assert.equal(signals.teams.promptContext.totalTeams, 2);
  assert.equal(signals.teams.promptContext.teamsShown, 1);
  assert.equal(signals.teams.promptContext.highestUrgencyTeam, 'Sales & Revenue');
});

test('team chain breakdown signal has no defence of its own against a suppressed row', () => {
  // teamChainBreakdownSignal's own comparisons (row.chainState ===
  // 'Sponsorship Failed at Both Levels', etc.) naturally skip a null
  // chainState — but teamList maps every row unconditionally, falling
  // back to 'Unknown' per *field*, not per row, so a suppressed team's
  // NAME still lands in the string the AI prompt is built from. This is
  // exactly why orgRoutes.js filters chainState: null rows out of
  // teams.rows/shownRows before calling buildSponsorshipSectionSignals at
  // all, rather than relying on this function to notice — pinned here so
  // that assumption can't quietly stop being true.
  const signals = buildSponsorshipSectionSignals({
    header: { clientName: 'Pancake Factory', stage: 'pre', threshold: 28, managerCount: 3 },
    subScores: {
      received: { avg: 13.2, threshold: 14 },
      capacity: { avg: 11.8, threshold: 14 },
    },
    load: { bands: [] },
    chain: { states: [] },
    crossMatrix: { rows: [] },
    teams: {
      rows: [
        { teamName: 'Wynn Delacroix', chainState: null, loadBand: null, receivedAvg: null, capacityAvg: null },
      ],
      shownRows: [
        { teamName: 'Wynn Delacroix', chainState: null, loadBand: null, receivedAvg: null, capacityAvg: null },
      ],
    },
  });
  assert.ok(signals.teams.promptContext.teamList.includes('Wynn Delacroix'));
});

test('orgRoutes-style pre-filtering keeps a suppressed team out of the team signal entirely', () => {
  // The other half of the contract: once the caller filters to
  // chainState != null (what orgRoutes.js actually does — see teamRows /
  // sampleSizeMetTeamRows), a suppressed team must not be named,
  // highest-urgency, or counted anywhere in the signal, matching the live
  // verification against Peter Panker's Pancake Factory (Wynn Delacroix,
  // 2 reports; Jerome Okafor, 3 reports — both below the floor of 5).
  const allRows = [
    { teamName: 'Wynn Delacroix', chainState: null, loadBand: null, receivedAvg: null, capacityAvg: null },
    { teamName: 'Jerome Okafor', chainState: null, loadBand: null, receivedAvg: null, capacityAvg: null },
    { teamName: 'Large Team', chainState: 'Sponsorship Failed at Both Levels', loadBand: 'Overloaded', receivedAvg: 2.5, capacityAvg: 2.4 },
  ];
  const sampleSizeMetRows = allRows.filter((row) => row.chainState != null);
  const signals = buildSponsorshipSectionSignals({
    header: { clientName: 'Pancake Factory', stage: 'pre', threshold: 28, managerCount: 3 },
    subScores: {
      received: { avg: 13.2, threshold: 14 },
      capacity: { avg: 11.8, threshold: 14 },
    },
    load: { bands: [] },
    chain: { states: [] },
    crossMatrix: { rows: [] },
    teams: { rows: sampleSizeMetRows, shownRows: sampleSizeMetRows },
  });
  assert.ok(!signals.teams.text.includes('Wynn Delacroix'));
  assert.ok(!signals.teams.text.includes('Jerome Okafor'));
  assert.ok(!signals.teams.promptContext.teamList.includes('Wynn Delacroix'));
  assert.ok(!signals.teams.promptContext.teamList.includes('Jerome Okafor'));
  assert.ok(signals.teams.promptContext.teamList.includes('Large Team'));
  assert.equal(signals.teams.promptContext.highestUrgencyTeam, 'Large Team');
  assert.equal(signals.teams.promptContext.totalTeams, 1);
  assert.equal(signals.teams.promptContext.teamsShown, 1);
});

test('sponsorship sub-score insight compares Received vs Capacity, not the combined score', () => {
  // Regression: received (13.7) fails its own 14-point threshold while capacity
  // (14.6) clears it. The combined 0-40 score (28.3) clears 28, but the insight
  // sits directly under the Received/Capacity cards and above the chain
  // verdict, both of which judge each sub-score independently — so it must
  // not report "both above threshold" just because the aggregate does.
  const signals = buildSponsorshipSectionSignals({
    header: {
      clientName: 'Roseland Enterprise',
      stage: 'pre',
      threshold: 28,
      managerCount: 12,
      managerAdoptionScore: 30,
      managerSponsorshipScore: 28.3,
    },
    subScores: {
      received: { avg: 13.7, threshold: 14 },
      capacity: { avg: 14.6, threshold: 14 },
    },
    load: { bands: [] },
    chain: { states: [] },
    crossMatrix: { rows: [] },
    teams: { rows: [], shownRows: [] },
  });
  assert.equal(
    signals.subScores.text,
    '<strong>Sponsorship Capacity is the stronger signal, but Sponsorship Received sits below threshold.</strong> Managers have the resilience and skill to sponsor their own teams effectively. What they\'re missing is credible, visible sponsorship from senior leadership above them. Only one of the two scores is above threshold, so the management layer is currently compensating for a gap above them rather than being properly supported.'
  );
  assert.equal(signals.subScores.promptContext.weakerSubScore, 'Received');
});

test('sponsorship sub-score insight covers both-above and both-below states', () => {
  const bothAbove = buildSponsorshipSectionSignals({
    header: { clientName: 'Acme', stage: 'pre', threshold: 28, managerCount: 12 },
    subScores: {
      received: { avg: 15, threshold: 14 },
      capacity: { avg: 16, threshold: 14 },
    },
    load: { bands: [] },
    chain: { states: [] },
    crossMatrix: { rows: [] },
    teams: { rows: [], shownRows: [] },
  });
  assert.ok(bothAbove.subScores.text.startsWith('<strong>Both Sponsorship Received and Sponsorship Capacity are above threshold.</strong>'));

  const bothBelow = buildSponsorshipSectionSignals({
    header: { clientName: 'Acme', stage: 'pre', threshold: 28, managerCount: 12 },
    subScores: {
      received: { avg: 10, threshold: 14 },
      capacity: { avg: 11, threshold: 14 },
    },
    load: { bands: [] },
    chain: { states: [] },
    crossMatrix: { rows: [] },
    teams: { rows: [], shownRows: [] },
  });
  assert.ok(bothBelow.subScores.text.startsWith('<strong>Both Sponsorship Received and Sponsorship Capacity sit below threshold.</strong>'));
});

test('adoption score card signal highlights absorption implication', () => {
  const signal = buildAdoptionScoreCardSignal({
    clientName: 'Acme',
    adoptionScore: 31.4,
    threshold: 28,
    currentQuadrant: 'Optimal',
    modalQuadrant: 'Optimal',
    assessmentStage: 'Pre-Change',
    respondentCount: 120,
  });
  assert.equal(signal.status, 'Above');
  assert.ok(signal.text.includes('<strong>'));
  assert.ok(signal.text.includes('absorb additional change load right now'));
  assert.equal(
    signal.blurb,
    'With the majority of respondents sitting within the Optimal quadrant, this score reflects how employees and managers collectively experience their readiness to absorb this change.'
  );
  assert.equal(signal.modalQuadrant, 'Optimal');
});

test('adoption score card blurb falls back to current quadrant when modal quadrant is absent', () => {
  const signal = buildAdoptionScoreCardSignal({
    clientName: 'Acme',
    adoptionScore: 31.4,
    threshold: 28,
    currentQuadrant: 'Capable but Wary',
  });
  assert.ok(signal.blurb.includes('within the Capable but Wary quadrant'));
});

test('sponsorship score card signal localizes deficit to received stream', () => {
  const signal = buildSponsorshipScoreCardSignal({
    clientName: 'Acme',
    sponsorshipScore: 25.2,
    threshold: 28,
    receivedScore: 12.8,
    capacityScore: 15.4,
    subScoreThreshold: 14,
    currentQuadrant: 'Motivated but Lost',
    modalQuadrant: 'Motivated but Lost',
    assessmentStage: 'Pre-Change',
    respondentCount: 120,
  });
  assert.equal(signal.status, 'Below');
  assert.equal(signal.deficitAnchor, 'received');
  assert.ok(signal.text.includes('delivered from above'));
  assert.ok(signal.text.includes('<strong>'));
  assert.equal(
    signal.blurb,
    'With the majority of respondents sitting within the Motivated but Lost quadrant, this score reflects how employees and managers collectively experience the credibility and visibility of leadership sponsorship.'
  );
});

test('top score card signals include fallback text when score missing', () => {
  const signals = buildTopScoreCardSignals({
    clientName: 'Acme',
    adoptionScore: null,
    sponsorshipScore: null,
    threshold: 28,
    receivedScore: null,
    capacityScore: null,
    subScoreThreshold: 14,
    currentQuadrant: 'Unknown',
    modalQuadrant: 'High Risk',
    assessmentStage: 'Pre-Change',
    respondentCount: 0,
  });
  assert.equal(signals.adoption.text, signals.adoption.fallback);
  assert.equal(signals.sponsorship.text, signals.sponsorship.fallback);
  assert.ok(signals.adoption.fallback.includes('within the High Risk quadrant'));
  assert.ok(signals.adoption.fallback.includes('readiness to absorb this change'));
  assert.ok(signals.sponsorship.fallback.includes('within the High Risk quadrant'));
  assert.ok(signals.sponsorship.fallback.includes('credibility and visibility of leadership sponsorship'));
});

test('likelihood what-this-means signal interprets spread and implication', () => {
  const signal = buildLikelihoodWhatThisMeansSignal({
    currentQuadrant: 'Motivated but Lost',
    optimalPct: 24,
    motivatedLostPct: 31,
    capableWaryPct: 21,
    highRiskPct: 24,
    launchStatus: 'Not Cleared',
  });
  assert.ok(signal.text.includes('<strong>'));
  assert.ok(signal.text.includes('outside Optimal'));
  assert.ok(signal.text.includes('should not execute a broad launch'));
});

test('likelihood what-this-means signal uses fallback when distribution missing', () => {
  const signal = buildLikelihoodWhatThisMeansSignal({
    currentQuadrant: null,
    optimalPct: null,
    motivatedLostPct: null,
    capableWaryPct: null,
    highRiskPct: null,
    launchStatus: 'Not Cleared',
  });
  assert.equal(signal.text, signal.fallback);
  assert.ok(signal.fallback.includes('spread across all four readiness states'));
});

test('quadrant explanation prompt is spec-locked', () => {
  assert.ok(
    SCORE_CARD_SIGNAL_PROMPTS.quadrant.system.startsWith(
      'You are a change readiness analyst writing a concise signal banner for a senior practitioner dashboard for RhythmEngine'
    )
  );
  assert.ok(SCORE_CARD_SIGNAL_PROMPTS.quadrant.system.includes('Maximum 3 sentences'));
  assert.ok(SCORE_CARD_SIGNAL_PROMPTS.quadrant.system.includes('prioritise High Risk'));
  assert.ok(SCORE_CARD_SIGNAL_PROMPTS.quadrant.user.includes('{{client_name}}'));
  assert.ok(SCORE_CARD_SIGNAL_PROMPTS.quadrant.user.includes('{{assessment_stage}}'));
  assert.ok(SCORE_CARD_SIGNAL_PROMPTS.quadrant.user.includes('{{respondent_count}}'));
  assert.ok(SCORE_CARD_SIGNAL_PROMPTS.quadrant.user.includes('{{largest_deficit_quadrant}}'));
  assert.equal(
    SCORE_CARD_SIGNAL_PROMPTS.quadrant.fallback,
    'The quadrant distribution shows what proportion of the organisation currently has the conditions in place to absorb and sustain this change. Review the Optimal percentage against the largest deficit segment to understand the scale of intervention required before this programme can proceed with confidence.'
  );
});

test('quadrant explanation signal leads with Optimal then names largest deficit', () => {
  const signal = buildQuadrantExplanationSignal({
    optimalPct: 39,
    motivatedLostPct: 21,
    capableWaryPct: 12,
    highRiskPct: 28,
    adoptionScore: 22,
    sponsorshipScore: 30,
    threshold: 28,
  });
  assert.ok(signal.text.includes('<strong>39% of respondents are positioned in Optimal</strong>'));
  // Largest non-Optimal is High Risk at 28
  assert.equal(signal.largestDeficitName, 'High Risk');
  assert.equal(signal.largestDeficitPct, 28);
  assert.ok(signal.text.includes('28% sit in High Risk'));
  // Adoption below, sponsorship above => barrier is adoption
  assert.equal(signal.barrier, 'adoption');
  assert.ok(signal.text.includes('lifting adoption readiness'));
  // Spec: 3 sentences
  assert.equal(signal.text.split(/(?<=\.)\s+/).filter(Boolean).length, 3);
});

test('quadrant explanation signal prioritises High Risk on ties with other deficits', () => {
  const signal = buildQuadrantExplanationSignal({
    optimalPct: 40,
    motivatedLostPct: 20,
    capableWaryPct: 20,
    highRiskPct: 20,
    adoptionScore: 30,
    sponsorshipScore: 30,
    threshold: 28,
  });
  assert.equal(signal.largestDeficitName, 'High Risk');
  assert.equal(signal.largestDeficitPct, 20);
});

test('quadrant explanation signal calls out both barriers when both scores below threshold', () => {
  const signal = buildQuadrantExplanationSignal({
    optimalPct: 12,
    motivatedLostPct: 32,
    capableWaryPct: 24,
    highRiskPct: 32,
    adoptionScore: 18,
    sponsorshipScore: 17,
    threshold: 28,
  });
  // Tied Motivated but Lost (32) and High Risk (32) — High Risk must win
  assert.equal(signal.largestDeficitName, 'High Risk');
  assert.equal(signal.barrier, 'both');
  assert.ok(signal.text.includes('both sponsorship credibility and adoption readiness'));
});

test('quadrant explanation signal calls out sponsorship barrier when only sponsorship is below', () => {
  const signal = buildQuadrantExplanationSignal({
    optimalPct: 35,
    motivatedLostPct: 25,
    capableWaryPct: 20,
    highRiskPct: 20,
    adoptionScore: 30,
    sponsorshipScore: 22,
    threshold: 28,
  });
  assert.equal(signal.barrier, 'sponsorship');
  assert.ok(signal.text.includes('lifting sponsorship credibility'));
});

test('quadrant explanation signal uses fallback when distribution is empty', () => {
  const signal = buildQuadrantExplanationSignal({
    optimalPct: 0,
    motivatedLostPct: 0,
    capableWaryPct: 0,
    highRiskPct: 0,
    adoptionScore: 30,
    sponsorshipScore: 30,
    threshold: 28,
  });
  assert.equal(signal.text, signal.fallback);
  assert.equal(signal.barrier, 'insufficient_data');
});

test('quadrant explanation signal expresses proportions as percentages, never fractions', () => {
  const signal = buildQuadrantExplanationSignal({
    optimalPct: 39,
    motivatedLostPct: 21,
    capableWaryPct: 12,
    highRiskPct: 28,
    adoptionScore: 22,
    sponsorshipScore: 30,
    threshold: 28,
  });
  assert.ok(!/\d+\s*\/\s*\d+/.test(signal.text), `signal text should not contain fractions: ${signal.text}`);
  assert.ok(/\d+%/.test(signal.text));
});

test('normalizeAssessmentStageLabel maps timepoint codes to display labels', () => {
  assert.equal(normalizeAssessmentStageLabel('pre'), 'Pre-Change');
  assert.equal(normalizeAssessmentStageLabel('during'), 'Mid-Change');
  assert.equal(normalizeAssessmentStageLabel('mid'), 'Mid-Change');
  assert.equal(normalizeAssessmentStageLabel('completed'), 'Post-Change');
  assert.equal(normalizeAssessmentStageLabel('post'), 'Post-Change');
  assert.equal(normalizeAssessmentStageLabel(null), 'Pre-Change');
  assert.equal(normalizeAssessmentStageLabel('Pre-Change'), 'Pre-Change');
});
