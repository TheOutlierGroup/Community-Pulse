# Security Penetration Closeout Runbook

Date: 2026-04-30

## Purpose

Close security penetration testing with a repeatable baseline run, targeted manual checks, DAST, and final risk sign-off.

## 1) Automated baseline (single command)

Prerequisites:
- Local dependencies installed in `backend` and `frontend`
- Render/local env values available in `backend/scripts/load/.env.render.local`

Run:

```bash
cd /Users/lukeford/Dev/Employee-Pulse/backend
set -a
source scripts/load/.env.render.local
set +a
npm run security:baseline
```

What this command runs:
- backend auth/token regression tests
- frontend invalid-token browser abuse test
- backend/frontend production dependency audits
- scripted abuse baseline
- scripted IDOR/privilege smoke
- scripted token/input abuse smoke

Outputs:
- `docs/security-results-YYYY-MM-DD/*.log`
- Required checks fail the command; dependency audits are recorded as warnings if advisories remain.

## 2) Manual privilege escalation checks (remaining)

Needs at least two identities (admin + non-admin role):
- attempt admin-only routes with non-admin token
- attempt cross-org resource access for each role
- verify blocked statuses and no data leakage in response bodies

Record:
- route, role, expected status, actual status, result

## 3) Input abuse checks (remaining manual depth)

Validate high-risk input paths beyond scripted smoke:
- CSV import payload edge cases (oversized fields, malformed rows)
- rich text/script payload persistence/render paths
- ensure rejected payloads do not execute client-side

Record:
- payload shape, endpoint, expected handling, observed result

## 4) Authenticated DAST (remaining)

Current local environment does not have DAST tooling installed.

Recommended options:
- OWASP ZAP baseline/full scan (preferred with authenticated context)
- Nuclei targeted templates for web/API

Minimum evidence:
- scan config/scope
- finding list by severity
- false-positive triage notes

## 5) Risk acceptance + sign-off

Use `docs/security-risk-acceptance-2026-04-29.md` as baseline.

Before final close:
- update each open advisory with final disposition
- set owner + remediation target or review date
- add security owner sign-off statement

## 6) Final completion statement template

"Security penetration testing is complete for the agreed scope. Automated baseline and scripted abuse checks passed, manual privilege/input checks were executed, DAST findings were triaged, and residual risks were accepted/documented with owners and review dates."
