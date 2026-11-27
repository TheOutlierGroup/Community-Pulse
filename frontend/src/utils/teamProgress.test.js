import test from 'node:test';
import assert from 'node:assert/strict';
import { teamsFromDashboard, lineOfBestFit, trendDirection, buildTeamSeries } from './teamProgress.js';

test('teamsFromDashboard keeps reported teams and drops withheld ones', () => {
  const teams = teamsFromDashboard({
    byManager: [
      { managerEmail: 'A@x.test', teamName: 'Distillery', adoptionScore: 24, sponsorshipScore: 20, sampleSizeMet: true },
      { managerEmail: 'b@x.test', teamName: 'Sales', adoptionScore: null, sponsorshipScore: null, sampleSizeMet: false },
    ],
  });
  assert.deepEqual(teams, [{ key: 'a@x.test', label: 'Distillery', adoption: 24, sponsorship: 20 }]);
  assert.deepEqual(teamsFromDashboard(null), []);
});

test('line of best fit matches least squares', () => {
  const fit = lineOfBestFit([{ x: 0, y: 20 }, { x: 1, y: 24 }, { x: 2, y: 25 }]);
  assert.equal(Math.round(fit.slope * 100) / 100, 2.5);
  assert.equal(Math.round(fit.at(0) * 100) / 100, 20.5);
  assert.equal(lineOfBestFit([{ x: 1, y: 20 }]), null, 'one checkpoint is not a trend');
});

test('direction bands: rising, flat, falling', () => {
  assert.equal(trendDirection(2), 'rising');
  assert.equal(trendDirection(0.2), 'flat');
  assert.equal(trendDirection(-1), 'falling');
  assert.equal(trendDirection(NaN), 'none');
});

test('series match teams across checkpoints and skip withheld points', () => {
  const stages = [
    { label: 'Pre', teams: [{ key: 'a', label: 'Distillery', adoption: 20 }, { key: 'b', label: 'Sales', adoption: 30 }] },
    { label: 'During', teams: [{ key: 'a', label: 'Distillery', adoption: 24 }] },
    { label: 'Post', teams: [{ key: 'a', label: 'Distillery', adoption: 28 }, { key: 'b', label: 'Sales', adoption: 26 }] },
  ];
  const series = buildTeamSeries(stages, 'adoption');
  const distillery = series.find((s) => s.key === 'a');
  const sales = series.find((s) => s.key === 'b');
  assert.deepEqual(distillery.points.map((p) => p.x), [0, 1, 2]);
  assert.equal(distillery.direction, 'rising');
  assert.equal(distillery.change, 4);
  assert.deepEqual(sales.points.map((p) => p.stage), ['Pre', 'Post'], 'During withheld');
  assert.equal(sales.direction, 'falling');
});
