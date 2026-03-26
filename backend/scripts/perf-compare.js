import fs from 'node:fs/promises';
import path from 'node:path';

function asNumber(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function pctDelta(base, curr) {
  if (base == null || curr == null || base === 0) return null;
  return ((curr - base) / base) * 100;
}

function fmtMs(v) {
  if (v == null) return '-';
  return `${v.toFixed(1)}ms`;
}

function fmtPct(v) {
  if (v == null) return '-';
  const sign = v > 0 ? '+' : '';
  return `${sign}${v.toFixed(1)}%`;
}

function readArg(flag, fallback = null) {
  const args = process.argv.slice(2);
  const idx = args.indexOf(flag);
  if (idx < 0 || idx + 1 >= args.length) return fallback;
  return args[idx + 1];
}

function pickMetric(summary, key) {
  if (!summary) return null;
  return asNumber(summary[key]);
}

function compareOne(label, baseSummary, currSummary) {
  const baseP50 = pickMetric(baseSummary, 'p50Ms');
  const currP50 = pickMetric(currSummary, 'p50Ms');
  const baseP95 = pickMetric(baseSummary, 'p95Ms');
  const currP95 = pickMetric(currSummary, 'p95Ms');
  const baseAvg = pickMetric(baseSummary, 'avgMs');
  const currAvg = pickMetric(currSummary, 'avgMs');

  return {
    label,
    baseP50,
    currP50,
    p50DeltaPct: pctDelta(baseP50, currP50),
    baseP95,
    currP95,
    p95DeltaPct: pctDelta(baseP95, currP95),
    baseAvg,
    currAvg,
    avgDeltaPct: pctDelta(baseAvg, currAvg),
  };
}

function printRow(row) {
  const name = row.label.padEnd(16);
  const p50 = `${fmtMs(row.baseP50)} -> ${fmtMs(row.currP50)} (${fmtPct(row.p50DeltaPct)})`.padEnd(34);
  const p95 = `${fmtMs(row.baseP95)} -> ${fmtMs(row.currP95)} (${fmtPct(row.p95DeltaPct)})`.padEnd(34);
  const avg = `${fmtMs(row.baseAvg)} -> ${fmtMs(row.currAvg)} (${fmtPct(row.avgDeltaPct)})`;
  console.log(`${name} p50 ${p50} p95 ${p95} avg ${avg}`);
}

async function loadJson(filePath) {
  const full = path.resolve(filePath);
  const raw = await fs.readFile(full, 'utf8');
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || !parsed.summaries) {
    throw new Error(`Invalid benchmark JSON: ${filePath}`);
  }
  return parsed;
}

async function main() {
  const baselinePath = readArg('--baseline');
  const currentPath = readArg('--current');
  if (!baselinePath || !currentPath) {
    console.error('Usage: node scripts/perf-compare.js --baseline <baseline.json> --current <current.json>');
    process.exit(1);
  }

  const baseline = await loadJson(baselinePath);
  const current = await loadJson(currentPath);

  const labels = new Set([
    ...Object.keys(baseline.summaries || {}),
    ...Object.keys(current.summaries || {}),
  ]);

  const ordered = ['task-list', 'task-detail', 'task-reorder'];
  const remaining = [...labels].filter((k) => !ordered.includes(k)).sort();
  const allLabels = [...ordered.filter((k) => labels.has(k)), ...remaining];

  console.log('Performance Comparison');
  console.log(`Baseline: ${path.resolve(baselinePath)}`);
  console.log(`Current:  ${path.resolve(currentPath)}`);
  console.log('');

  let improved = 0;
  let regressed = 0;
  let unchanged = 0;

  for (const label of allLabels) {
    const row = compareOne(label, baseline.summaries[label], current.summaries[label]);
    printRow(row);
    if (row.p95DeltaPct == null) continue;
    if (row.p95DeltaPct < -1) improved += 1;
    else if (row.p95DeltaPct > 1) regressed += 1;
    else unchanged += 1;
  }

  console.log('');
  console.log(`Rollup: improved=${improved} regressed=${regressed} unchanged=${unchanged} (by p95, +/-1% threshold)`);
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
