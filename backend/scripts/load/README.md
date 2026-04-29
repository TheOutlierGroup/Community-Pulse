# k6 Load Test Scripts

These scripts map to MVP non-functional checks and are intended for staging/nightly runs.

## Required tooling

- Install k6 locally: [https://k6.io/docs/get-started/installation/](https://k6.io/docs/get-started/installation/)

## Common environment variables

- `K6_BASE_URL` - Base API URL (default `http://127.0.0.1:3001`)
- `K6_AUTH_BEARER` - Optional bearer token for authenticated endpoints
- `K6_SURVEY_SUBMIT_PATH` - Submit path for survey completion
- `K6_DASHBOARD_PATH` - Dashboard endpoint path
- `K6_SLUG_PATH` - Slug resolution endpoint path
- `K6_ALLOW_429` - Treat `429` as expected (useful for controlled stress tests where rate-limiting is expected)

Profile controls:
- `K6_DASHBOARD_VUS`, `K6_DASHBOARD_DURATION`, `K6_DASHBOARD_P95_MS`, `K6_DASHBOARD_MAX_FAIL_RATE`
- `K6_SLUG_RATE`, `K6_SLUG_DURATION`, `K6_SLUG_PREALLOCATED_VUS`, `K6_SLUG_MAX_VUS`, `K6_SLUG_P95_MS`, `K6_SLUG_MAX_FAIL_RATE`
- `K6_SURVEY_STAGE1_DURATION`, `K6_SURVEY_STAGE1_TARGET`, `K6_SURVEY_STAGE2_DURATION`, `K6_SURVEY_STAGE2_TARGET`, `K6_SURVEY_STAGE3_DURATION`, `K6_SURVEY_STAGE3_TARGET`, `K6_SURVEY_P95_MS`, `K6_SURVEY_MAX_FAIL_RATE`
- `K6_SURVEY_ITERATION_SLEEP_SECONDS` - Optional per-iteration pause to avoid over-driving a single test token
- `K6_FRESHNESS_POLL_INTERVAL_SECONDS`, `K6_FRESHNESS_REQUIRE_INCREASE`
- `K6_SOAK_VUS`, `K6_SOAK_DURATION`, `K6_SOAK_SUBMIT_RATIO`, `K6_SOAK_P95_MS`, `K6_SOAK_MAX_FAIL_RATE`

Freshness note:
- If you reuse an already-completed token, set `K6_FRESHNESS_REQUIRE_INCREASE=false` (non-strict smoke check).
- For strict freshness validation, use a fresh token and set `K6_FRESHNESS_REQUIRE_INCREASE=true`.

### Local Render-targeted env file

Use the included template and local file:

- Template (committed): `backend/scripts/load/.env.render.example`
- Local secrets file (gitignored): `backend/scripts/load/.env.render.local`

Run any load script with:

```bash
cd backend
set -a
source scripts/load/.env.render.local
set +a
npm run perf:k6:dashboard
```

Or one-liner:

```bash
cd backend && set -a && source scripts/load/.env.render.local && set +a && npm run perf:k6:slug
```

Tip: For strict release gates, keep `K6_ALLOW_429=false`. For rate-limit behavior validation, set `K6_ALLOW_429=true`.

## Scripts

- `npm run perf:k6:survey` - 500-concurrency survey submission profile
- `npm run perf:k6:dashboard` - 50-user dashboard burst profile
- `npm run perf:k6:freshness` - post-submit freshness polling check
- `npm run perf:k6:slug` - high-RPS slug resolution profile
- `npm run perf:k6:soak` - 30-minute mixed soak profile
