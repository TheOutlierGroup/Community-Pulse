import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { buildReportDocx } from './reportDocxBuilder.js';

/**
 * Cover-page logo lock-up layout: the client's company logo and the
 * Rhythm Engine (or brand) logo used to always render as two separate,
 * centered paragraphs — the brand logo on one line, the company logo
 * stacked underneath it, which looked squished. When both are present
 * they should share one line instead: company logo left-aligned, brand
 * logo right-aligned, inside a borderless two-cell table. With only one
 * of the two present, the single-centered-line layout is unchanged.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RE_LOGO = fs.readFileSync(path.resolve(__dirname, '../assets/rhythm-engine-logo.png'));
const OUTLIER_LOGO = fs.readFileSync(path.resolve(__dirname, '../assets/outlier-logo.png'));

function reportFixture() {
  const dims = ['1A', '1B', '1C', '1D', '2A', '2B', '2C', '2D'].map((id) => ({
    id, label: `Dimension ${id}`, managerLabel: `Manager ${id}`, avg: 3.5, sampleSizeMet: true,
  }));
  return {
    org: { id: 'org-1', name: 'Ventora Showers', slug: 'ventora', report_contact: null },
    stage: 'pre',
    generated_at: new Date().toISOString(),
    totals: {
      responses: 14, invited: 20, response_rate: 70,
      employee_count: 8, employee_pct: 57, manager_count: 6, manager_pct: 43,
      teams_in_scope: 'Team A, Team B',
    },
    readiness: {
      adoption_score: 30, sponsorship_score: 30,
      adoption_status: 'HIGH', sponsorship_status: 'HIGH',
      quadrant: 'Q1', quadrant_label: 'Optimal', verdict: 'CLEARED FOR LAUNCH',
    },
    dimensions: {
      employee: dims, manager: dims,
      employee_sample_size_met: true, manager_sample_size_met: true,
      adoption_floor: null, sponsorship_floor: null,
    },
    manager: {
      sample_size_met: true, manager_count: 6, min_sample_size: 5,
      load_distribution: [
        { name: 'Sustainable', count: 6, percent: 100 },
        { name: 'Stretched', count: 0, percent: 0 },
        { name: 'At Capacity', count: 0, percent: 0 },
        { name: 'Overloaded', count: 0, percent: 0 },
      ],
      sponsorship_received_avg: 15, sponsorship_capacity_avg: 15,
      sponsorship_chain_distribution: [
        { name: 'Chain Functioning', count: 6, percent: 100 },
        { name: 'Breaking at Manager Level', count: 0, percent: 0 },
        { name: 'Managers Resilient, Under-Supported', count: 0, percent: 0 },
        { name: 'Sponsorship Failed at Both Levels', count: 0, percent: 0 },
      ],
      load_chain_matrix: [{
        loadBand: 'Sustainable',
        cells: [
          { chainState: 'Chain Functioning', count: 6 },
          { chainState: 'Breaking at Manager Level', count: 0 },
          { chainState: 'Managers Resilient, Under-Supported', count: 0 },
          { chainState: 'Sponsorship Failed at Both Levels', count: 0 },
        ],
      }],
    },
    teams: [],
    alerts: [],
    suppression: {
      min_sample_size: 5, employee_sample_size_met: true,
      manager_sample_size_met: true, suppressed_team_count: 0,
    },
  };
}

async function render({ companyLogoBuffer = null } = {}) {
  const buf = await buildReportDocx({
    reportData: reportFixture(),
    signals: {},
    defaultLogoBuffer: RE_LOGO,
    companyLogoBuffer,
  });
  const zip = await JSZip.loadAsync(buf);
  const xml = await zip.file('word/document.xml').async('string');
  const files = [];
  zip.folder('word/media')?.forEach((_rel, f) => files.push(f));
  const images = await Promise.all(files.map((f) => f.async('nodebuffer')));
  return { xml, images };
}

test('cover logo lock-up: company logo and brand logo share one line when both are present', async () => {
  const { xml, images } = await render({ companyLogoBuffer: OUTLIER_LOGO });
  assert.ok(images.some((b) => b.equals(RE_LOGO)), 'brand logo should be embedded');
  assert.ok(images.some((b) => b.equals(OUTLIER_LOGO)), 'company logo should be embedded');

  // Both logo <w:drawing> elements should sit inside the same table row
  // (one <w:tbl>...</w:tbl> block), not as two separate top-level
  // paragraphs each carrying one image.
  const tableMatch = xml.match(/<w:tbl>[\s\S]*?<\/w:tbl>/);
  assert.ok(tableMatch, 'expected a table wrapping the side-by-side logos');
  const drawingsInTable = (tableMatch[0].match(/<w:drawing>/g) || []).length;
  assert.equal(drawingsInTable, 2, 'both logos should be embedded inside the same table');
});

test('cover logo lock-up: falls back to a single centered logo when there is no company logo', async () => {
  const { xml, images } = await render({ companyLogoBuffer: null });
  assert.ok(images.some((b) => b.equals(RE_LOGO)), 'brand logo should still be embedded');
  assert.equal(images.length, 1, 'only the brand logo should be embedded');

  // The report body has other (data) tables further down, so this can't
  // just assert "no <w:tbl> anywhere" — only that the cover logo itself,
  // the very first drawing in the document, isn't sitting inside one.
  const drawingIndex = xml.indexOf('<w:drawing>');
  const tableIndex = xml.indexOf('<w:tbl>');
  assert.ok(drawingIndex >= 0, 'expected the cover logo to be embedded');
  assert.ok(
    tableIndex === -1 || tableIndex > drawingIndex,
    'no side-by-side table should wrap the cover logo when only one logo is present'
  );
});
