import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CRM_ONLY_PAGE_IMPORTS } from '../src/crmOnlyPages.js';

/**
 * BRAND-02: the check behind "only Rhythm Engine pages are served from
 * the Rhythm Engine site" — by actually building both surfaces and
 * inspecting the output, the same way the original defect was found
 * ("inspect the served application assets"). AppRhythmEngine.test.js
 * covers the same invariant at source-text speed for routine test runs;
 * this is the ground-truth version, run on demand (`npm run
 * verify:surface-bundles`) since it does two full production builds.
 *
 * Detection is filename-only: every page in CRM_ONLY_PAGE_IMPORTS is
 * wired up via `lazy(() => import(...))`, and Rollup always gives a
 * dynamic import() its own chunk rather than inlining it into whatever
 * references it — that's what makes "does a chunk named after this page
 * exist" a precise signal instead of a heuristic. It's also literally
 * what the original defect's repro steps describe (inspect the served
 * assets, look for CRM pages among them). Scanning chunk *contents* for a
 * page's name was tried and dropped: several of these pages share a stem
 * with legitimate shared-code identifiers (Login/loginUrl,
 * crmLoginUrl/"Log in to CRM" text), so it flagged clean builds.
 */

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workDir = mkdtempSync(path.join(tmpdir(), 'surface-bundle-check-'));
const pulseDir = path.join(workDir, 'dist-pulse');
const crmDir = path.join(workDir, 'dist-crm');

function build(surface, outDir) {
  console.log(`Building ${surface} surface -> ${outDir}`);
  execFileSync(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['vite', 'build', '--outDir', outDir, '--emptyOutDir', '--logLevel', 'warn'],
    {
      cwd: frontendRoot,
      env: { ...process.env, VITE_APP_SURFACE: surface },
      stdio: 'inherit',
    }
  );
}

function jsFilenames(dir) {
  const assetsDir = path.join(dir, 'assets');
  return readdirSync(assetsDir).filter((name) => name.endsWith('.js'));
}

try {
  build('pulse', pulseDir);
  build('crm', crmDir);

  const pulseFilenames = jsFilenames(pulseDir);
  const crmFilenames = jsFilenames(crmDir);

  const leaks = [];
  const missingFromCrm = [];

  for (const marker of CRM_ONLY_PAGE_IMPORTS) {
    const stem = marker.replace(/\.jsx?$/, '');
    if (pulseFilenames.some((name) => name.startsWith(`${stem}-`))) {
      leaks.push(`${marker}: has its own chunk in the pulse build`);
    }
    if (!crmFilenames.some((name) => name.startsWith(`${stem}-`))) {
      missingFromCrm.push(marker);
    }
  }

  if (missingFromCrm.length > 0) {
    console.warn(
      'Note: the following expected CRM-only pages were not found as their own chunk in the ' +
        'CRM build (rename, merge, or removal?) — update crmOnlyPages.js if intentional:\n' +
        missingFromCrm.map((m) => `  - ${m}`).join('\n')
    );
  }

  if (leaks.length > 0) {
    console.error('\nFAIL: CRM-only pages found in the Rhythm Engine (pulse) build:');
    for (const leak of leaks) console.error(`  - ${leak}`);
    process.exitCode = 1;
  } else {
    console.log('\nPASS: no CRM-only page found in the Rhythm Engine (pulse) build output.');
  }
} finally {
  rmSync(workDir, { recursive: true, force: true });
}
