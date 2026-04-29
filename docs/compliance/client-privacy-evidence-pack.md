# Client Privacy Evidence Pack

Date: 2026-04-29  
Scope: Q5, Q6, Q7, Q8, Q9, Q10, Q14, Q15, Q18, Q21, Q22, Q27, Q28

## Validation snapshot

- Backend tests: `106 passed, 0 failed`
- Frontend tests: `20 passed, 0 failed`
- Last local verification run date: 2026-04-29

## Requirement traceability

| Requirement | Implementation Evidence | Verification Evidence | Status |
|---|---|---|---|
| Q5 T+90 cron built/tested | `backend/src/services/retentionPolicy.js`, `backend/src/jobs/retentionSweep.js`, `render.yaml` cron `pulse-retention-sweep` | backend tests pass; retention job now emits structured output + heartbeat run id | Implemented (staging run pending) |
| Q6 Delete identifier fields at T+90 | `anonymizeClosedProjectIdentifiers()` + field map in `getRetentionFieldPolicy()` | backend tests pass; audit event `retention.anonymize_identifiers` emitted | Implemented (field policy may expand) |
| Q7 Dead-man switch + alerting | `retention_job_runs` schema + `checkRetentionHeartbeat()` + webhook alert sender | backend tests pass; runbook includes alert validation steps | Implemented (webhook env test pending) |
| Q8 Closure trigger for 90-day clock | `pulse_sessions` status includes `paused`; `closed_at` used by retention query | lifecycle integration tests pass | Implemented |
| Q9 Manual permanent deletion + audit | `POST /api/platform/privacy/permanent-delete`; `privacy_deletion_requests`; audit event `privacy.permanent_delete` | backend tests pass | Implemented |
| Q10 Archive inactive clients + process | `archiveInactiveClientOrganizations()`, archive mark endpoint, quarterly review report job | backend tests pass; archive review job wired | Implemented (policy tuning pending) |
| Q14 MFA for admin accounts | `auth.js` MFA setup/verify/disable + login MFA check; `auth.js` + `auth.middleware` enforcement | `mfa.test.js` + `middleware/auth.test.js` pass | Implemented |
| Q15 Immutable audit logs + retention model | `audit_events` table with mutation-blocking triggers; centralized `auditLog.js` | backend tests pass; mutation protection at DB trigger layer | Implemented (external sink retention attestation pending) |
| Q18 Client dashboard scoped auth flow | `clientDashboardAuth.js`; issue/redeem endpoints in `auth.js` with single-use + expiry semantics | backend tests pass | Implemented |
| Q21 CRM/project status and transition logs | `PulseSessionStatusEvent` model + status event table + admin route support | backend integration tests for paused lifecycle pass | Implemented |
| Q22 Overseas data handling controls | invite/respondent metadata fields (`respondent_country_code`, `privacy_notice_version`, `consent_recorded_at`) | backend tests pass | Partial (legal policy finalization pending) |
| Q27 Tier-3 archive controls | org archive/tier3 fields + archive mark/review endpoints + quarterly job scaffold | backend tests pass | Partial (infra encryption/immutability attestation pending) |
| Q28 APP12/13 access/deletion workflow | `privacy_requests` model + create/update/list routes + immediate purge hook | backend tests pass | Implemented (operational SLA reporting cadence pending) |

## Files introduced for privacy control implementation

- `backend/src/migrations/032_privacy_controls.sql`
- `backend/src/services/auditLog.js`
- `backend/src/services/mfa.js`
- `backend/src/services/clientDashboardAuth.js`
- `backend/src/models/PulseSessionStatusEvent.js`
- `backend/src/models/PrivacyRequest.js`
- `backend/src/services/privacyDeletion.js`
- `backend/src/routes/platform/privacyRoutes.js`
- `backend/src/services/archiveReview.js`
- `backend/src/jobs/archiveReviewReport.js`
- `docs/compliance/privacy-ops-runbook.md`

## Remaining sign-off dependencies (non-code)

1. Verify `RETENTION_ALERT_WEBHOOK` delivery in staging/prod.
2. Confirm external immutable sink and 7-year retention policy attestation.
3. Confirm cloud storage encryption and access-policy evidence for Tier-3 archive.
4. Complete legal/privacy approval for overseas transfer policy wording and disclosure.
5. Run and archive one full staging retention job report and one archive quarterly report output.

## Recommended next verification runbook

1. Deploy current branch to staging.
2. Run `npm run retention:sweep` with production-like data.
3. Create and close one DSAR `access` request and one `deletion` request.
4. Execute one manual permanent delete with and without legal hold.
5. Generate archive review report and capture output.
6. Export audit event samples for all above actions.
