# Load + Security Completion Plan

Date: 2026-04-29  
Owner: Engineering

## Current Status Snapshot

### Load/performance
- k6 environment is configured for local execution against Render via `backend/scripts/load/.env.render.local`.
- Load script execution is now complete for dashboard, slug, survey, freshness, soak, and platform tasks benchmark.
- Captured evidence is stored in `docs/load-results-2026-04-29/`.
- Dashboard baseline (20s) is validated at low concurrency:
  - 1 VU: pass, `http_req_failed=0%`, p95 `~772ms`
  - 2 VUs: pass, `http_req_failed=0%`, p95 `~879ms`
  - 3 VUs: pass, `http_req_failed=0%`, p95 `~748ms`
- Decision recorded: `429` is treated as an expected guardrail response in controlled stress/load tests (`K6_ALLOW_429=true`), not a production defect.

### Security/penetration
- Automated auth/token baseline tests previously executed and passing.
- Invalid-token browser abuse path previously executed and passing.
- Dependency audit baseline previously captured with actionable vulnerabilities to triage.
- Full manual penetration workflow and DAST are not yet complete.

## Completion Plan

1. **Finalize load baseline and thresholds**
   - Keep current dashboard profile results (1-3 VUs pass) as baseline.
   - Decide whether 4-5 VU behavior is acceptable due to intended rate-limiting policy.
   - If required, run additional staged tests with tuned route-specific thresholds.

2. **Run remaining k6 scripts on Render**
   - Execute survey, freshness, slug, soak, and platform task benchmark using Render-targeted env.
   - Capture pass/fail, p95 latency, and failure-rate metrics for each script.

3. **Complete security penetration phase**
   - Re-run baseline automated checks to confirm no regressions.
   - Execute manual penetration checklist (IDOR, privilege boundaries, token abuse, upload/input abuse).
   - Run DAST sweep (authenticated crawl if available).

4. **Publish final client-facing report**
   - Consolidate evidence and clearly mark completed vs deferred items.
   - Include any risk acceptance notes (for example dependency advisories without upstream fixes).

## TODO Checklist

### Load/performance
- [x] Re-run dashboard k6 at 1/2/3 VUs and save outputs in a dated folder.
- [x] Decide and document expected behavior for 429 at 4+ VUs (acceptable guardrail vs failure).
- [x] Run `npm run perf:k6:slug` and capture p95 + failed-rate.
- [x] Run `npm run perf:k6:survey` and capture p95 + failed-rate.
- [x] Run `npm run perf:k6:freshness` and capture freshness-window result.
- [x] Run `npm run perf:k6:soak` in off-peak test window and capture stability metrics.
- [x] Run `npm run perf:platform-tasks` with `PERF_TOKEN` and `PERF_ORG_ID`.
- [x] Write a short summary table of all load script outcomes.

### Security/penetration
- [ ] Re-run auth/token baseline suite and attach results.
- [ ] Re-run invalid-token browser abuse test and attach results.
- [ ] Run `npm audit --omit=dev` for backend/frontend and update findings list.
- [ ] Perform manual IDOR checks across platform org/task/report routes.
- [ ] Perform privilege-escalation checks across role boundaries.
- [ ] Perform token misuse checks (expired, altered, replayed tokens).
- [ ] Perform input abuse checks (CSV/import edge payloads, rich text/script payloads).
- [ ] Run DAST scan (if tooling available) and triage findings.
- [ ] Create risk acceptance notes for unresolved upstream dependency vulnerabilities.

### Reporting/handoff
- [x] Update `docs/client-test-plan-and-results.md` with latest measured results.
- [ ] Add final "Completed" statement for load/perf and security sections.
- [ ] Share final report with client stakeholders.

## Load Summary Table (2026-04-29)

Artifacts folder: `docs/load-results-2026-04-29/`

| Script | Profile | Result | p95 | Failed-rate | Notes |
|---|---|---|---|---|---|
| `perf:k6:dashboard` | 1 VU, 20s | Pass | `~772ms` | `0.00%` | Baseline low concurrency |
| `perf:k6:dashboard` | 2 VUs, 20s | Pass | `~879ms` | `0.00%` | Baseline low concurrency |
| `perf:k6:dashboard` | 3 VUs, 20s | Pass | `~748ms` | `0.00%` | Baseline low concurrency |
| `perf:k6:slug` | 3 req/s, 20s | Pass | `~150ms` | `0.00%` | Render-safe rate |
| `perf:k6:survey` | 1 VU staged (35s total) | Pass | `~160ms` | `0.00%` | Iteration pacing enabled |
| `perf:k6:freshness` | 1 iteration | Pass | checks `100%` | `0.00%` | Non-strict increase mode for reused token |
| `perf:k6:soak` | 3 VUs, 3m | Pass | `~198ms` | `0.00%` | Off-peak shortened soak baseline |
| `perf:platform-tasks` | 20 measured runs | Pass | task-list `~181ms`, task-detail `~268ms` | `0/20 fail` each | JSON + log captured |

## Load/Performance Completion Statement

Load/performance script execution is complete for this cycle, with evidence captured and all configured thresholds passing under the Render-targeted baseline profile.

## Re-run Commands

```bash
cd /Users/lukeford/Dev/Employee-Pulse/backend
set -a
source scripts/load/.env.render.local
set +a

npm run perf:k6:dashboard
npm run perf:k6:slug
npm run perf:k6:survey
npm run perf:k6:freshness
npm run perf:k6:soak
npm run perf:platform-tasks
```

