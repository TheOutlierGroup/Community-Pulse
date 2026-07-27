import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { buildReportDocx } from './reportDocxBuilder.js';

/**
 * BRAND-01: reports are a Rhythm Engine artefact, routinely delivered by
 * Practitioners to their own clients, so Outlier's name and logo must not
 * appear on them.
 *
 * Asserts against the rendered document rather than the source, because
 * the branding that matters is what a client actually receives — and
 * because the first pass of this work missed a hardcoded
 * "hello@theoutliergroup.com" fallback that a source search for "Outlier"
 * never matched.
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

async function render({ brand = null, defaultLogoBuffer = RE_LOGO, reportData = reportFixture() } = {}) {
  const buf = await buildReportDocx({ reportData, signals: {}, brand, defaultLogoBuffer });
  const zip = await JSZip.loadAsync(buf);
  const xml = await zip.file('word/document.xml').async('string');
  const text = xml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const files = [];
  zip.folder('word/media')?.forEach((_rel, f) => files.push(f));
  const images = await Promise.all(files.map((f) => f.async('nodebuffer')));
  return { text, images };
}

test('BRAND-01: a default report carries no Outlier name or address', async () => {
  const { text } = await render();
  // Case-insensitive, and covers the domain form too — the original miss
  // was "theoutliergroup.com", which no search for "Outlier" would catch.
  assert.equal(/outlier/i.test(text), false, 'no Outlier reference should survive in the rendered text');
});

test('BRAND-01: a default report presents itself as Rhythm Engine', async () => {
  const { text } = await render();
  assert.match(text, /Prepared by Rhythm Engine/);
  assert.match(text, /Contact Rhythm Engine to discuss/);
  assert.match(text, /proprietary to Rhythm Engine/);
});

test('BRAND-01: the Rhythm Engine logo is embedded and the Outlier logo is not', async () => {
  const { images } = await render();
  assert.ok(images.length > 0, 'the cover should embed a logo');
  assert.ok(images.some((b) => b.equals(RE_LOGO)), 'Rhythm Engine mark should be embedded');
  assert.ok(!images.some((b) => b.equals(OUTLIER_LOGO)), 'Outlier logo must never be embedded');
});

test('BRAND-01: a Practitioner brand displaces Rhythm Engine throughout', async () => {
  const { text } = await render({ brand: { displayName: 'Roseland Enterprise' } });
  assert.match(text, /Prepared by Roseland Enterprise/);
  assert.match(text, /Contact Roseland Enterprise to discuss/);
  assert.match(text, /proprietary to Roseland Enterprise/);
  assert.equal(/outlier/i.test(text), false);
});

test("BRAND-01: the contact line falls back to the Practitioner's support details", async () => {
  const { text } = await render({
    brand: { displayName: 'Roseland Enterprise', supportEmail: 'help@roseland.example', supportUrl: 'roseland.example' },
  });
  assert.match(text, /help@roseland\.example/);
  assert.match(text, /roseland\.example/);
});

test('BRAND-01: no contact line is invented when none is configured', async () => {
  // Previously this printed Outlier's own email and website by default.
  const { text } = await render();
  assert.equal(/@/.test(text.split('Ready to act on these findings?')[1] || ''), false,
    'no email address should appear in the call-to-action when none is configured');
});

test("BRAND-01: an explicit per-org report contact still wins", async () => {
  const reportData = reportFixture();
  reportData.org.report_contact = 'consultant@client.example';
  const { text } = await render({ reportData });
  assert.match(text, /consultant@client\.example/);
});
