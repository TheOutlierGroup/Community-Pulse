# Privacy Operations Runbook

Date: 2026-04-29  
Applies to: Employee Pulse production operations

## Purpose

This runbook defines the operational steps for:
- nightly retention/anonymization
- DSAR (APP12/13-style) request handling
- manual permanent deletion
- Tier-3 archive quarterly review

## Required environment configuration

Set in production environment:
- `RETENTION_PROJECT_CLOSE_DAYS=90`
- `RETENTION_DRY_RUN=false`
- `RETENTION_ALERT_EMAIL=<comma-separated recipient list>`
- `RETENTION_ALERT_WEBHOOK=<optional fallback webhook>`
- `MFA_ENFORCE_ADMIN=true`
- `CLIENT_DASHBOARD_TOKEN_MAX_HOURS=24`
- `TIER3_DISPOSAL_YEARS=7`

## Scheduled jobs

Configured in `render.yaml`:
- `pulse-retention-sweep` (daily)
  - command: `cd backend && npm run privacy:maintenance`
  - includes quarterly archive review on quarter-start day

## 1) Nightly retention/anonymization operations

### Objective

Anonymize identifier fields for eligible closed-project records and archive inactive organizations.

### Inputs

- Eligible rows from `pulse_sessions.closed_at <= now - 90 days`
- Inactive organizations from `last_activity_at`/`created_at` age windows

### Execution

1. Run job:
   - `cd backend && npm run privacy:maintenance`
2. Confirm output includes:
   - `policy`
   - `fields`
   - `anonymize.recordsScanned`
   - `anonymize.recordsAnonymized`
   - `archive.recordsArchived`
   - `heartbeat.runId`
3. Validate heartbeat:
   - `retention_job_runs` last row for `retention_sweep` has `status = ok`

### Failure handling

If job fails:
1. Confirm alert delivered to `RETENTION_ALERT_EMAIL` (or webhook fallback if email is not configured).
2. Query latest run:
   - check `error_code`, `error_message`, `details`.
3. Resolve data/config issue.
4. Re-run once manually.
5. Create incident note with run id and corrective action.

## 2) DSAR / privacy request handling

### Objective

Handle access/deletion requests within 30-day SLA and maintain full audit trace.

### Intake

Use platform API:
- `POST /api/platform/privacy/requests`
  - required: `organizationId`, `requestType`, `subjectEmail`
  - optional: `subjectName`, `requestDetails`, `respondentCountryCode`, `privacyNoticeVersion`

### Workflow states

`received` -> `in_review` -> (`fulfilled` | `denied` | `cancelled`)

### Update state

- `PATCH /api/platform/privacy/requests/:id`
  - required body: `organizationId`
  - optional: `status`, `identityVerified`, `requestDetails`, `metadata`

### Immediate purge rule

For deletion requests requiring immediate handling:
- send `triggerImmediatePurge=true` at request creation.
- system will execute immediate anonymization handoff and emit audit event.

### SLA checks

At least daily:
1. list requests where `status` not final and `due_at` <= now + 3 days.
2. escalate overdue records to compliance owner.

## 3) Manual permanent deletion procedure

### Objective

Provide controlled deletion/anonymization outside automated retention windows.

### Execution

- `POST /api/platform/privacy/permanent-delete`
  - required:
    - `organizationId`
    - `targetType`
    - `targetId`
    - `reason`
    - `confirmation=PERMANENT_DELETE`
  - optional:
    - `legalHold=true` to block execution when required

### Controls

- Admin-only route
- mandatory reason
- immutable audit event recorded for request + result
- deletion request row persisted with outcome

## 4) Tier-3 archive operations

### Mark archive status

- `POST /api/platform/privacy/archive/mark`
  - required: `organizationId`
  - sets `archived_at`, `tier3_archive_at`, `tier3_disposal_due_at`

### Quarterly review

- automated via `npm run archive:review`
- ad-hoc via:
  - `GET /api/platform/privacy/archive/review-report`

### Review checklist

For each archived organization:
1. verify disposal due date.
2. flag records in `<= 90 days` window.
3. confirm access activity appears in audit events.
4. record compliance decision (retain/dispose).

## 5) Audit evidence checks

Use:
- `GET /api/platform/privacy/audit-events`

Verify events for:
- login attempts and outcomes
- MFA setup/verify/disable
- dashboard token issue/redeem
- retention anonymization runs
- privacy request create/update
- manual delete operations
- archive marking/review

## 6) Operator handoff checklist

- [ ] Env vars configured in production
- [ ] Daily retention cron active
- [ ] Quarterly archive review path confirmed from same cron job
- [ ] Alert email tested
- [ ] DSAR queue review cadence assigned
- [ ] Evidence snapshots stored for compliance sign-off
