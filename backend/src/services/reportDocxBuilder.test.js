import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { buildReportDocx } from './reportDocxBuilder.js';

async function extractDocxText(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file('word/document.xml').async('string');
  return xml
    .replace(/<w:p(?:\s[^>]*)?>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

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
    teams: [
      {
        name: 'Team Alpha',
        response_count: 5,
        employee_count: 4,
        manager_count: 1,
        adoption_score: 31.2,
        sponsorship_score: 29.4,
        adoption_status: 'HIGH',
        sponsorship_status: 'HIGH',
        quadrant: 'optimal',
        quadrant_label: 'Optimal',
        manager_load_band: 'Sustainable',
      },
      {
        name: 'Team Bravo',
        response_count: 3,
        employee_count: 3,
        manager_count: 0,
        adoption_score: 22.0,
        sponsorship_score: 19.5,
        adoption_status: 'LOW',
        sponsorship_status: 'LOW',
        quadrant: 'high_risk',
        quadrant_label: 'High Risk',
        manager_load_band: null,
      },
    ],
    alerts: [{ severity: 'WARNING', title: 'Dimension Floor', description: 'Watch 2A trend.' }],
  };
}

const signals = {
  executive: 'Executive signal text.',
  adoption: 'Adoption signal text.',
  sponsorship: 'Sponsorship signal text.',
  managerLoad: 'Manager load signal text.',
  chain: 'Chain signal text.',
  teams: 'Team breakdown signal text.',
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

test('buildReportDocx skips team-level breakdown when teams array is empty', async () => {
  const reportData = { ...makeReportData(), teams: [] };
  const buffer = await buildReportDocx({ reportData, signals });
  assert.ok(Buffer.isBuffer(buffer));
  assert.ok(buffer.length > 500);
});

test('buildReportDocx skips team-level breakdown when teams field is missing', async () => {
  const reportData = makeReportData();
  delete reportData.teams;
  const buffer = await buildReportDocx({ reportData, signals });
  assert.ok(Buffer.isBuffer(buffer));
  assert.ok(buffer.length > 500);
});

// D-008 (REA-02 notes): a downloaded report showed Word's "unreadable
// content" recovery prompt. XML 1.0 treats most C0 control characters as
// illegal even escaped, so one slipping into any TextRun (most plausibly
// via AI-generated commentary, the least constrained text source feeding
// this builder) corrupts the whole document, not just that run.
test('buildReportDocx strips illegal XML control characters from AI-generated text and still produces a valid document', async () => {
  const dirtySignals = {
    ...signals,
    executive: 'Adoption is on track.\x0BSponsorship needs work.\x1F',
  };
  const buffer = await buildReportDocx({ reportData: makeReportData(), signals: dirtySignals });
  assert.ok(Buffer.isBuffer(buffer));
  const text = await extractDocxText(buffer);
  // eslint-disable-next-line no-control-regex
  assert.doesNotMatch(text, /[\x00-\x08\x0B\x0C\x0E-\x1F]/);
  assert.match(text, /Adoption is on track\.\s*Sponsorship needs work\./);
});

// D-017: the Readiness Quadrant page showed the quadrant classification
// (label, description, active-cell marker) but never the adoption/
// sponsorship scores that produced it -- readable earlier in the report,
// on "Key Scores at a Glance", but not next to the quadrant grid itself.
test('buildReportDocx shows the adoption and sponsorship scores next to the Readiness Quadrant', async () => {
  const buffer = await buildReportDocx({ reportData: makeReportData(), signals });
  const text = await extractDocxText(buffer);
  const quadrantIndex = text.indexOf('Readiness Quadrant');
  assert.ok(quadrantIndex >= 0, 'expected a Readiness Quadrant heading');
  const nearby = text.slice(quadrantIndex, quadrantIndex + 400);
  assert.match(nearby, /31\/40/, 'expected the adoption score near the quadrant heading');
  assert.match(nearby, /30\/40/, 'expected the sponsorship score near the quadrant heading');
});

// D-017: EXE-05's passing bar is explicit -- "Australian English with no
// em dashes" -- and reportDocxBuilder.js used to use one as body-copy
// punctuation, a heading separator, and a blank-cell placeholder glyph
// throughout the document.
test('buildReportDocx never emits an em dash anywhere in the document', async () => {
  const buffer = await buildReportDocx({ reportData: makeReportData(), signals });
  const text = await extractDocxText(buffer);
  assert.doesNotMatch(text, /—/);
});

const PNG_MAGIC_BUFFER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPEG_MAGIC_BUFFER = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
const UNRECOGNISED_BUFFER = Buffer.from('not an image', 'utf8');

async function docxMediaEntries(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  return Object.keys(zip.files).filter((name) => name.startsWith('word/media/') && !name.endsWith('/'));
}

// D-008/D-017 (REA-02): every real report embeds at least the default
// Rhythm Engine logo, so this hit every download, not just ones with a
// company logo. docx v9's ImageRun needs an explicit `type` to name and
// declare the embedded media part -- without one, `type` was `undefined`
// at runtime, and the library wrote the logo out as
// word/media/<hash>.undefined, an extension [Content_Types].xml has no
// Default entry for. That's exactly the "unreadable content" class of
// corruption Word prompts to repair on open.
test('buildReportDocx names an embedded logo by its real image type, not "undefined"', async () => {
  const buffer = await buildReportDocx({
    reportData: makeReportData(),
    signals,
    defaultLogoBuffer: PNG_MAGIC_BUFFER,
  });
  const media = await docxMediaEntries(buffer);
  assert.equal(media.length, 1);
  assert.match(media[0], /\.png$/);
  assert.doesNotMatch(media[0], /undefined/);
});

test('buildReportDocx detects a JPEG logo correctly', async () => {
  const buffer = await buildReportDocx({
    reportData: makeReportData(),
    signals,
    defaultLogoBuffer: JPEG_MAGIC_BUFFER,
  });
  const media = await docxMediaEntries(buffer);
  assert.equal(media.length, 1);
  assert.match(media[0], /\.jpg$/);
});

test('buildReportDocx omits a logo it cannot identify instead of corrupting the document', async () => {
  const buffer = await buildReportDocx({
    reportData: makeReportData(),
    signals,
    defaultLogoBuffer: UNRECOGNISED_BUFFER,
  });
  const media = await docxMediaEntries(buffer);
  assert.equal(media.length, 0);
});
