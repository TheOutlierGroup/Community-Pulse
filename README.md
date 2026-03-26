# Pulse

Organizational diagnostic platform: employee Pulse flow and admin analytics. Stack: **Node.js (Express)**, **PostgreSQL**, **React (Vite)**.

## Prerequisites

- Node.js 20+
- PostgreSQL 14+

## Local setup

1. Create a database and copy env:

   ```bash
   cp backend/.env.example backend/.env
   # Edit DATABASE_URL, JWT_SECRET
   ```

2. Install and migrate (from repo root):

   ```bash
   ./build.sh
   ```

   Or manually:

   ```bash
   cd backend && npm install && npm run migrate && npm run seed
   cd ../frontend && npm install --include=dev && npm run build
   ```

3. **Admin login** (from seed):
   - `SEED_ADMIN_EMAIL` defaults to `admin@localhost` if not set.
   - Set `SEED_ADMIN_PASSWORD` explicitly, or for local dev use the generated password printed by `npm run seed`.

4. Run API (serves built frontend if `frontend/dist` exists):

   ```bash
   cd backend && npm run dev
   ```

5. For frontend hot reload during development:

   ```bash
   cd frontend && npm run dev
   ```

   Vite proxies `/api` to `http://localhost:3001`. Set `FRONTEND_ORIGIN=http://localhost:5173` in `backend/.env`.

## Render.com

- On Render, `NODE_ENV` is often `production` during build, so a plain `npm install` **omits devDependencies**. This repo’s `build.sh` uses `npm install --include=dev` in `frontend/` so **Vite** is available for `vite build`.

- Create a **PostgreSQL** instance and note `DATABASE_URL`.
- Attach a **persistent disk** and set `STORAGE_PATH` to the mount path (e.g. `/var/data`).
- Web service: root directory repo, build command `./build.sh`, start command `cd backend && npm start`.
- Set env: `DATABASE_URL`, `JWT_SECRET`, `INVITE_TOKEN_SECRET`, `NODE_ENV=production`, `FRONTEND_ORIGIN` (your app URL).
- Optional hardening env:
  - `JWT_ISSUER`, `JWT_AUDIENCE` (pins token issuer/audience)
  - `DATABASE_CA_CERT_PATH` (verify DB server cert with CA; preferred)
  - `DATABASE_SSL_ALLOW_SELF_SIGNED=true` (temporary fallback only)
  - `ENFORCE_HTTPS=true` (default in production unless explicitly disabled)

See [render.yaml](./render.yaml) for a blueprint-style reference.

## Performance benchmark (task board)

Use this to compare task-board API latency before/after backend changes.

```bash
cd backend
PERF_BASE_URL="https://your-staging-host.com" \
PERF_TOKEN="your-platform-jwt" \
PERF_ORG_ID="client-org-uuid" \
PERF_ENABLE_WRITES=true \
PERF_OUTPUT_JSON="./perf-current.json" \
npm run perf:platform-tasks
```

Environment variables:

- `PERF_BASE_URL` (default: `http://localhost:5000`)
- `PERF_TOKEN` (**required**)
- `PERF_ORG_ID` (**required**)
- `PERF_TASK_ID` (optional; defaults to first task in list)
- `PERF_RUNS` (default: `20`)
- `PERF_WARMUP` (default: `3`)
- `PERF_TIMEOUT_MS` (default: `15000`)
- `PERF_TASK_LIMIT` (default: `500`)
- `PERF_ENABLE_WRITES` (default: `false`; set `true` to include reorder timings)
- `PERF_OUTPUT_JSON` (optional; writes machine-readable JSON summary)

Notes:

- The script reports `avg`, `p50`, `p95`, `min`, and `max` for `task-list`, `task-detail`, and (optionally) `task-reorder`.
- Reorder benchmarking performs real `PATCH` requests, so use it on dev/staging environments.

Compare two runs:

```bash
cd backend
npm run perf:compare -- \
  --baseline ./perf-baseline.json \
  --current ./perf-current.json
```

This prints side-by-side `p50`/`p95`/`avg` and percentage deltas, plus a simple p95 rollup.

## API overview

- `POST /api/auth/login` — email/password
- `GET /api/auth/invite/:token` — validate invite
- `POST /api/auth/accept-invite` — `{ token, password }`
- `GET /api/pulse/*` — employee Pulse (JWT, role `employee`)
- `GET|POST /api/admin/*`, `/api/analytics/*` — admin (JWT, role `admin`)

## License

Private / your org.
