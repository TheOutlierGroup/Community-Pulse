import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReportDocx } from './reportDocxBuilder.js';

function makeReportData({ includeMatrix = true } = {}) {
  const matrix = includeMatrix
    ? [
        {
          loadBand: 'Sustainable',
          cells: [
            { chainState: 'Chain Functioning', count: 2 },
            { chainState: 'Breaking at Manager Level', count: 1 },
            { chainState: 'Managers Resilient, Under-Supported', count: 0 },
            { chainState: 'Sponsorship Failed at Both Levels', count: 0 },
          ],
        },
      ]
    : [];

  return {
    org: { name: 'Client A', report_contact: 'hello@example.com' },
    stage: 'pre',
    generated_at: new Date().toISOString(),
    totals: {
      responses: 12,
      employee_count: 8,
      employee_pct: 66.7,
      manager_count: 4,
      manager_pct: 33.3,
      teams_in_scope: 'Mgr A, Mgr B',
    },
    readiness: {
      verdict: 'CLEARED FOR LAUNCH',
      quadrant_label: 'Optimal',
      adoption_score: 31,
      sponsorship_score: 30,
      adoption_status: 'HIGH',
      sponsorship_status: 'HIGH',
    },
    dimensions: {
      employee: [
        { id: '1A', label: 'Competence & Capability', avg: 4.2 },
        { id: '2A', label: 'Visible Sponsorship', avg: 4.0 },
      ],
      manager: [{ id: '1A', managerLabel: 'Enabling Team Competence', avg: 4.1 }],
    },
    manager: {
      load_distribution: [{ name: 'Sustainable', percent: 75, count: 3 }],
      sponsorship_chain_distribution: [{ name: 'Chain Functioning', percent: 75, count: 3 }],
      load_chain_matrix: matrix,
    },
    alerts: [{ severity: 'WARNING', title: 'Dimension Floor', description: 'Watch 2A trend.' }],
  };
}

const signals = {
  executive: 'Executive signal text.',
  adoption: 'Adoption signal text.',
  sponsorship: 'Sponsorship signal text.',
  managerLoad: 'Manager load signal text.',
  chain: 'Chain signal text.',
  keyFindings: ['Finding one', 'Finding two'],
  nextStepsOrder: ['Manager Enablement Programme', 'Mid-Change Assessment'],
};

test('buildReportDocx returns non-empty DOCX buffer for complete data', async () => {
  const buffer = await buildReportDocx({ reportData: makeReportData(), signals });
  assert.ok(Buffer.isBuffer(buffer));
  assert.ok(buffer.length > 500);
  // DOCX is a ZIP container; standard ZIP header starts with PK.
  assert.equal(buffer[0], 0x50);
  assert.equal(buffer[1], 0x4b);
});

test('buildReportDocx tolerates empty load-chain matrix without throwing', async () => {
  const buffer = await buildReportDocx({
    reportData: makeReportData({ includeMatrix: false }),
    signals: { ...signals, nextStepsOrder: [] },
  });
  assert.ok(Buffer.isBuffer(buffer));
  assert.ok(buffer.length > 500);
});
