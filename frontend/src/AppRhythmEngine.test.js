import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CRM_ONLY_PAGE_IMPORTS } from './crmOnlyPages.js';

/**
 * BRAND-02 regression cover.
 *
 * The Rhythm Engine build must never bundle Outlier's CRM admin pages —
 * see AppRhythmEngine.jsx's header comment for the full incident. That
 * guarantee rests on two things holding at once: this file must not
 * import any CRM-only page, and main.jsx must pick between App.jsx and
 * AppRhythmEngine.jsx using a literal, same-file import.meta.env check
 * rather than a runtime boolean from another module (config/appSurface.js's
 * IS_RHYTHM_ENGINE_SURFACE) — the latter is exactly the indirection that
 * let Rollup bundle both surfaces' pages together in the first place, so
 * reverting to it silently reopens the leak even with this file in place.
 *
 * These are source-text checks rather than a real build, so they run at
 * unit-test speed. They can't see transitive imports pulled in by a
 * shared page/component, so they're a fast tripwire for the likely
 * regressions (editing this file, or "simplifying" main.jsx's condition),
 * not a substitute for actually building both surfaces and inspecting
 * dist/ — do that by hand (or via a build-based check) after touching
 * either file.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const appRhythmEngineSource = fs.readFileSync(path.join(here, 'AppRhythmEngine.jsx'), 'utf8');
const mainSource = fs.readFileSync(path.join(here, 'main.jsx'), 'utf8');

test('AppRhythmEngine.jsx imports no CRM-only page', () => {
  for (const filename of CRM_ONLY_PAGE_IMPORTS) {
    assert.ok(
      !appRhythmEngineSource.includes(filename),
      `AppRhythmEngine.jsx must not reference ${filename} — that page must only ship in the CRM build`
    );
  }
});

test('main.jsx selects the surface entry via a literal import.meta.env check', () => {
  assert.match(
    mainSource,
    /import\.meta\.env\.VITE_APP_SURFACE\s*===\s*['"]pulse['"]/,
    'main.jsx must branch on a literal import.meta.env.VITE_APP_SURFACE comparison in this file, ' +
      'not a boolean imported from config/appSurface.js — only the inline literal form is ' +
      "guaranteed to let Vite/Rollup drop the untaken branch's import() from the build"
  );
  assert.ok(
    !/^\s*import\b.*appSurface\.js/m.test(mainSource),
    'main.jsx must not import config/appSurface.js to decide the surface entry — reaching the ' +
      'decision through a boolean computed in another module is the indirection that let both ' +
      'surfaces bundle the same pages before BRAND-02'
  );
  assert.match(
    mainSource,
    /import\(['"]\.\/AppRhythmEngine\.jsx['"]\)/,
    'main.jsx must dynamically import AppRhythmEngine.jsx for the pulse surface'
  );
  assert.match(
    mainSource,
    /import\(['"]\.\/App\.jsx['"]\)/,
    'main.jsx must dynamically import App.jsx for the non-pulse surfaces'
  );
});
