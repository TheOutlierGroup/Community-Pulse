# Employee Pulse - Client Test Plan and Results

Date: 2026-04-24  
Prepared by: Engineering

## 1) Objective

Validate that Employee Pulse is stable and production-ready for client use across:
- Core backend logic and API protections
- Frontend business logic and routing behavior
- End-to-end user journeys in supported browsers
- Baseline accessibility checks on key public/auth screens

## 2) Test Scope

In scope:
- Automated backend tests (`node --test`)
- Automated frontend unit/integration tests (`node --test`)
- Automated frontend end-to-end tests (`Playwright`) across Chromium, Firefox, and WebKit
- Accessibility scan within E2E flow (axe)

Out of scope for this run:
- Load/performance scripts
- Security penetration testing
- Manual exploratory/UAT sessions
- Disaster recovery and infrastructure failover testing

## 3) Test Environment

- OS: macOS Darwin 24.6.0
- Repository: `Employee-Pulse`
- Date executed: 2026-04-24
- Browsers for E2E: Chromium, Firefox, WebKit (Playwright-managed)

## 4) Test Approach

1. Run backend automated suite
2. Run frontend automated suite
3. Run Playwright end-to-end suite (all configured browsers)
4. Capture pass/fail totals and notable warnings
5. Produce client-shareable summary and recommendation

## 5) Execution Results

### 5.1 Backend Automated Tests

- Command: `npm test` (in `backend`)
- Result: Pass
- Totals: 95 passed, 0 failed, 0 skipped
- Runtime: ~1.57s
- Coverage focus observed in suite:
  - Auth and authorization guards
  - Pulse completion/link flows
  - Admin and analytics endpoint behavior
  - Report generation/download auth and token handling
  - Scoring, stage logic, and import validation rules
  - Privacy and data-shaping protections

### 5.2 Frontend Unit/Integration Tests

- Command: `npm test` (in `frontend`)
- Result: Pass
- Totals: 16 passed, 0 failed, 0 skipped
- Runtime: ~0.31s
- Coverage focus observed in suite:
  - Report payload and filename helpers
  - Route targeting/navigation safeguards
  - Stage normalization behavior
  - CSV parsing and recipient import normalization

### 5.3 Frontend End-to-End + Accessibility Tests

- Command: `npm run test:e2e` (in `frontend`)
- Result: Pass
- Totals: 12 passed, 0 failed
- Runtime: ~30.3s
- Browser matrix:
  - Chromium: pass
  - Firefox: pass
  - WebKit: pass
- Scenario coverage:
  - Login screen renders expected auth controls
  - Invalid public link token handled safely
  - Report history controls hidden where not expected
  - Accessibility scan reports no critical axe violations on login flow

Note: Initial E2E attempt failed due missing local Playwright browser binaries. After running `npx playwright install`, the full E2E suite passed.

## 6) Consolidated Quality Summary

- Total automated tests executed: 123
- Total passed: 123
- Total failed: 0
- Overall automated test status: Green

## 7) Risks / Observations

- Non-blocking console warnings observed from React Router future flags during E2E runs.
- No functional failures or accessibility-critical violations were detected in this test cycle.

## 8) Client-Facing Conclusion

Based on this execution cycle, the platform passed all automated backend, frontend, and cross-browser end-to-end tests with no failing cases.  
Current test evidence supports release readiness for the validated scope.

## 9) Recommended Next Validation (Optional)

For final go-live confidence with stakeholders, run:
- Targeted UAT with client-specific real workflows/data
- Security-focused test pass (authz boundaries, token misuse, upload hardening)
- Performance/load scripts under expected usage profile

## 10) Load/Performance + Security Penetration Plan (Started 2026-04-24)

### 10.1 Goals

- Validate API responsiveness and stability under expected and stress usage profiles.
- Validate that auth/token boundaries and public endpoints resist common abuse patterns.
- Produce repeatable scripts that can run locally for smoke checks and in staging for full validation.

### 10.2 Scope for this phase

In scope now:
- Load/performance script readiness checks and first execution attempt
- Security baseline: dependency audit readiness, backend auth/token regression suite, and browser invalid-token abuse flow

Deferred to follow-up cycle:
- Full k6 load execution against staged data and realistic traffic model
- Automated DAST sweep (for example OWASP ZAP authenticated crawl)
- Manual penetration workflow (IDOR, privilege escalation, file upload abuse, rate-limit bypass)

### 10.3 Load/Performance test scripts and runbook

Existing scripts (backend):
- `npm run perf:k6:survey` (`scripts/load/perf-survey-submission.js`)
- `npm run perf:k6:dashboard` (`scripts/load/perf-dashboard-load.js`)
- `npm run perf:k6:freshness` (`scripts/load/perf-dashboard-freshness.js`)
- `npm run perf:k6:slug` (`scripts/load/perf-slug-resolution.js`)
- `npm run perf:k6:soak` (`scripts/load/perf-soak.js`)
- `npm run perf:platform-tasks` (`scripts/bench-platform-tasks.js`)

Pre-requisites:
- Install `k6` locally
- Start backend API locally or point to staging
- Configure:
  - `K6_BASE_URL`
  - `K6_AUTH_BEARER` (for authenticated endpoints)
  - `PERF_TOKEN` and `PERF_ORG_ID` (for `perf:platform-tasks`)

Execution sequence:
1. Smoke: `npm run perf:k6:dashboard`
2. Burst: `npm run perf:k6:slug`
3. Submission ramp: `npm run perf:k6:survey`
4. Data freshness: `npm run perf:k6:freshness`
5. Stability soak: `npm run perf:k6:soak`
6. Endpoint benchmark: `npm run perf:platform-tasks`

Initial pass/fail targets:
- `http_req_failed < 0.1%`
- Dashboard p95 < 2000ms
- Survey submit p95 < 500ms (or document and accept revised threshold by environment)

### 10.4 Security penetration test plan

Automated baseline (start in CI/local):
- Backend auth/token-focused tests:
  - `src/middleware/auth.test.js`
  - `src/security/inviteToken.test.js`
  - `src/services/reportDownloadToken.test.js`
  - `src/routes/reports.test.js`
- Browser abuse-path checks (Playwright):
  - Invalid public pulse token handling (`frontend/e2e/smoke-and-a11y.spec.js`)

Dependency and supply-chain checks:
- Run `npm audit --omit=dev` where lockfiles are present
- Add/maintain lockfiles per package so audits can run consistently

Manual/assisted penetration checklist (next phase):
- Authentication/authorization:
  - Cross-org access attempts (IDOR) on platform routes
  - Role escalation attempts across admin/platform/pulse user surfaces
- Token and session abuse:
  - Replay of expired/altered handoff or download tokens
  - Tampered JWT and malformed bearer headers
- Input and payload abuse:
  - XSS payload injection on rich-text/task-comment surfaces
  - CSV/import payload edge cases and parser stress
- Availability controls:
  - Rate-limit bypass attempts on auth and invite endpoints
  - Brute-force style access pattern simulation

### 10.5 Test execution started - results

Load/performance status:
- `k6` installed successfully (`k6 v1.7.1`)
- `npm run perf:k6:dashboard` executed against local `http://127.0.0.1:3001`
  - Outcome: threshold fail (`http_req_failed=100%`)
  - Throughput/latency: `736,438` requests over `60s`, p95 `5.6ms`
  - Interpretation: endpoint/path is reachable but returning non-2xx/3xx responses under this profile; endpoint/env alignment required before using this as release gate
- `npm run perf:k6:slug` executed after script fix
  - Script fix applied: `scripts/load/perf-slug-resolution.js` now uses integer `rate` (`17`) so k6 can parse scenario config
  - Outcome: threshold fail (`http_req_failed=100%`) while functional check passed (`slug endpoint status is acceptable`)
  - Throughput/latency: `2,041` requests over `120s`, p95 `797µs`
  - Interpretation: script runs end-to-end; current threshold conflicts with allowed 4xx statuses in this environment
- `npm run perf:platform-tasks` -> blocked (`Missing required env vars: PERF_TOKEN and PERF_ORG_ID`)

Security status:
- Backend focused auth/token suite:
  - Command: `node --test src/middleware/auth.test.js src/security/inviteToken.test.js src/services/reportDownloadToken.test.js src/routes/reports.test.js`
  - Result: Pass
  - Totals: 18 passed, 0 failed
- Browser invalid-token abuse flow:
  - Command: `npm run test:e2e -- e2e/smoke-and-a11y.spec.js --grep "invalid token"`
  - Result: Pass
  - Totals: 3 passed (Chromium/Firefox/WebKit), 0 failed
- Dependency audit baseline:
  - Frontend `npm audit --omit=dev`: 4 vulnerabilities (3 moderate, 1 high), including `xlsx` high severity advisory with no current fix available
  - Backend `npm audit --omit=dev`: 4 vulnerabilities (3 moderate, 1 high), including `path-to-regexp` and `uuid` advisories

### 10.6 Immediate next actions

1. Set test-environment values for `K6_DASHBOARD_PATH` and `K6_SLUG_PATH` to routes expected to return successful status codes, or adjust thresholds to reflect intentional 401/404 behavior in unauthenticated smoke profiles.
2. Provision `PERF_TOKEN` and `PERF_ORG_ID` from a test org, then run `npm run perf:platform-tasks`.
3. Triage audit findings:
   - upgrade packages where non-breaking fixes exist (`npm audit fix`)
   - create a risk acceptance/mitigation note for `xlsx` until an upstream fix is available
4. Add a dedicated `security:baseline` script to bundle auth/token + invalid-token E2E checks for repeatability.
