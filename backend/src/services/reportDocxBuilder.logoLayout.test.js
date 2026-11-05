import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { buildReportDocx, readImageDimensions, fitLogoWithinBox } from './reportDocxBuilder.js';

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

// RED-061: logos were forced into fixed boxes, so a square client mark was
// stretched into a wide oval beside the brand logo. Each logo is now fitted
// inside its box at its own aspect ratio.
function minimalJpeg(width, height) {
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]);
  const sof = Buffer.alloc(19);
  sof.writeUInt16BE(0xffc0, 0);
  sof.writeUInt16BE(17, 2);
  sof[4] = 8;
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(width, 7);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof, Buffer.from([0xff, 0xd9])]);
}

test('readImageDimensions reads PNG and JPEG pixel sizes', () => {
  assert.deepEqual(readImageDimensions(RE_LOGO), { width: 600, height: 150 });
  assert.deepEqual(readImageDimensions(minimalJpeg(400, 400)), { width: 400, height: 400 });
  assert.equal(readImageDimensions(Buffer.from('not an image')), null);
});

test('fitLogoWithinBox keeps the aspect ratio inside the box', () => {
  assert.deepEqual(fitLogoWithinBox(minimalJpeg(400, 400), 170, 64), { width: 64, height: 64 });
  assert.deepEqual(fitLogoWithinBox(minimalJpeg(200, 500), 170, 64), { width: 26, height: 64 });
  assert.deepEqual(fitLogoWithinBox(RE_LOGO, 170, 51), { width: 170, height: 43 });
  // Unknown size falls back to the box rather than failing the report.
  assert.deepEqual(fitLogoWithinBox(Buffer.from('????'), 170, 64), { width: 170, height: 64 });
});

test('a square client logo is embedded square on the cover, not stretched', async () => {
  const { xml } = await render({ companyLogoBuffer: minimalJpeg(400, 400) });
  const tableMatch = xml.match(/<w:tbl>[\s\S]*?<\/w:tbl>/);
  const extents = [...tableMatch[0].matchAll(/<wp:extent cx="(\d+)" cy="(\d+)"/g)].map((m) => [Number(m[1]), Number(m[2])]);
  assert.equal(extents.length, 2);
  const [companyCx, companyCy] = extents[0];
  assert.equal(companyCx, companyCy, 'square logo should stay square');
});
