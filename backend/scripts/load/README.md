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

## Scripts

- `npm run perf:k6:survey` - 500-concurrency survey submission profile
- `npm run perf:k6:dashboard` - 50-user dashboard burst profile
- `npm run perf:k6:freshness` - post-submit freshness polling check
- `npm run perf:k6:slug` - high-RPS slug resolution profile
- `npm run perf:k6:soak` - 30-minute mixed soak profile
