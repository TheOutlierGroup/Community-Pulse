import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSponsorshipSectionSignals,
  buildDimensionFloorAlerts,
  buildSponsorshipDecliningAlert,
  buildTeamOutlierAlerts,
  buildThresholdCrossingAlerts,
  calculateLargestRemainderPercentages,
  headlineForVerdict,
  prioritizeAndCapAlerts,
  verdictForScores,
} from './pulseDashboardMetrics.js';

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
        { chainState: 'Sponsorship Failed at Both Levels', loadBand: 'Overloaded' },
        { chainState: 'Breaking at Manager Level', loadBand: 'Stretched' },
      ],
    },
  });
  assert.equal(signals.load.variant, 'red');
  assert.equal(signals.crossMatrix.variant, 'red');
  assert.equal(signals.teams.variant, 'red');
  assert.ok(signals.subScores.text.includes('13.2'));
});
