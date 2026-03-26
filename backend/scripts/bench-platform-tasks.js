import fs from 'node:fs/promises';
import { performance } from 'node:perf_hooks';

function env(name, fallback = undefined) {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  return raw;
}

function toInt(raw, fallback) {
  const n = Number.parseInt(String(raw ?? ''), 10);
  return Number.isInteger(n) ? n : fallback;
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, idx))];
}

function summarize(samples) {
  const ok = samples.filter((s) => s.ok).map((s) => s.ms).sort((a, b) => a - b);
  const fail = samples.length - ok.length;
  if (!ok.length) {
    return {
      runs: samples.length,
      ok: 0,
      fail,
      avgMs: null,
      p50Ms: null,
      p95Ms: null,
      minMs: null,
      maxMs: null,
    };
  }
  const avgMs = ok.reduce((a, b) => a + b, 0) / ok.length;
  return {
    runs: samples.length,
    ok: ok.length,
    fail,
    avgMs,
    p50Ms: percentile(ok, 50),
    p95Ms: percentile(ok, 95),
    minMs: ok[0],
    maxMs: ok[ok.length - 1],
  };
}

function fmt(ms) {
  if (ms == null) return '-';
  return `${ms.toFixed(1)}ms`;
}

async function timed(label, fn) {
  const started = performance.now();
  try {
    await fn();
    return { label, ok: true, ms: performance.now() - started };
  } catch (error) {
    return { label, ok: false, ms: performance.now() - started, error };
  }
}

async function requestJson({ baseUrl, token, method, path, body, timeoutMs }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const text = await res.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    if (!res.ok) {
      const msg = typeof data === 'object' && data?.error ? data.error : `${res.status} ${res.statusText}`;
      throw new Error(msg);
    }
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

async function runSeries({ label, warmupRuns, measuredRuns, fn }) {
  for (let i = 0; i < warmupRuns; i += 1) {
    await fn();
  }
  const samples = [];
  for (let i = 0; i < measuredRuns; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    samples.push(await timed(label, fn));
  }
  return samples;
}

function printSummary(label, stats) {
  console.log(
    `${label.padEnd(20)} runs=${String(stats.runs).padStart(3)} ok=${String(stats.ok).padStart(3)} fail=${String(
      stats.fail
    ).padStart(3)} avg=${fmt(stats.avgMs).padStart(8)} p50=${fmt(stats.p50Ms).padStart(8)} p95=${fmt(
      stats.p95Ms
    ).padStart(8)} min=${fmt(stats.minMs).padStart(8)} max=${fmt(stats.maxMs).padStart(8)}`
  );
}

async function main() {
  const baseUrl = String(env('PERF_BASE_URL', 'http://localhost:5000')).replace(/\/$/, '');
  const token = env('PERF_TOKEN');
  const orgId = env('PERF_ORG_ID');
  const explicitTaskId = env('PERF_TASK_ID');
  const warmupRuns = toInt(env('PERF_WARMUP', '3'), 3);
  const measuredRuns = toInt(env('PERF_RUNS', '20'), 20);
  const timeoutMs = toInt(env('PERF_TIMEOUT_MS', '15000'), 15000);
  const enableWrites = String(env('PERF_ENABLE_WRITES', 'false')).toLowerCase() === 'true';
  const taskLimit = toInt(env('PERF_TASK_LIMIT', '500'), 500);
  const outputJsonPath = env('PERF_OUTPUT_JSON');

  if (!token || !orgId) {
    console.error('Missing required env vars: PERF_TOKEN and PERF_ORG_ID');
    process.exit(1);
  }

  console.log('Platform Tasks Performance Benchmark');
  console.log(`Base URL: ${baseUrl}`);
  console.log(`Org ID: ${orgId}`);
  console.log(`Runs: ${measuredRuns} (warmup ${warmupRuns})`);
  console.log(`Writes enabled: ${enableWrites ? 'yes' : 'no (set PERF_ENABLE_WRITES=true to include reorder)'}`);
  console.log('');

  const listPath = `/api/platform/organizations/${orgId}/tasks?limit=${taskLimit}&offset=0`;
  const initial = await requestJson({
    baseUrl,
    token,
    method: 'GET',
    path: listPath,
    timeoutMs,
  });
  const tasks = Array.isArray(initial?.tasks) ? initial.tasks : [];
  if (!tasks.length) {
    console.error('No tasks returned for this organization. Need at least one task to benchmark detail/reorder.');
    process.exit(1);
  }
  const taskId = explicitTaskId || String(tasks[0].id);
  const detailPath = `/api/platform/organizations/${orgId}/tasks/${taskId}`;
  const reorderPath = `/api/platform/organizations/${orgId}/tasks/reorder`;
  const reorderPayload = {
    tasks: tasks.map((t) => ({
      id: t.id,
      status: t.status,
      position: t.position,
    })),
  };

  const results = [];
  results.push(
    ...(await runSeries({
      label: 'task-list',
      warmupRuns,
      measuredRuns,
      fn: () =>
        requestJson({
          baseUrl,
          token,
          method: 'GET',
          path: listPath,
          timeoutMs,
        }),
    }))
  );
  results.push(
    ...(await runSeries({
      label: 'task-detail',
      warmupRuns,
      measuredRuns,
      fn: () =>
        requestJson({
          baseUrl,
          token,
          method: 'GET',
          path: detailPath,
          timeoutMs,
        }),
    }))
  );
  if (enableWrites) {
    results.push(
      ...(await runSeries({
        label: 'task-reorder',
        warmupRuns,
        measuredRuns,
        fn: () =>
          requestJson({
            baseUrl,
            token,
            method: 'PATCH',
            path: reorderPath,
            body: reorderPayload,
            timeoutMs,
          }),
      }))
    );
  }

  const grouped = new Map();
  for (const sample of results) {
    const key = sample.label;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(sample);
  }

  console.log('Summary');
  console.log('-------');
  let hadAnySuccess = false;
  const summaries = {};
  for (const [label, samples] of grouped.entries()) {
    const stats = summarize(samples);
    hadAnySuccess = hadAnySuccess || stats.ok > 0;
    summaries[label] = stats;
    printSummary(label, stats);
  }

  const failed = results.filter((r) => !r.ok);
  if (failed.length) {
    console.log('');
    console.log(`Failures (${failed.length}):`);
    for (const f of failed.slice(0, 5)) {
      console.log(`- ${f.label}: ${f.error?.message || 'unknown error'}`);
    }
  }

  if (outputJsonPath) {
    const payload = {
      benchmark: 'platform-tasks',
      generatedAt: new Date().toISOString(),
      config: {
        baseUrl,
        orgId,
        taskId,
        warmupRuns,
        measuredRuns,
        timeoutMs,
        taskLimit,
        enableWrites,
      },
      summaries,
    };
    await fs.writeFile(outputJsonPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    console.log('');
    console.log(`Wrote JSON results to ${outputJsonPath}`);
  }

  if (!hadAnySuccess) process.exit(1);
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
