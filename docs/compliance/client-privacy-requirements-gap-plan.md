# Client Privacy Requirements Gap Plan

Date: 2026-04-29  
Owner: Engineering (with Compliance, Legal, and Infra sign-off)

## 1) Scope

This plan maps the client privacy requirement set (Q5, Q6, Q7, Q8, Q9, Q10, Q14, Q15, Q18, Q21, Q22, Q27, Q28) to the current Employee Pulse build, defines required implementation work, and provides a release gate checklist for 100% requirement coverage.

## 2) Current Build vs Requirement Matrix

Status legend:
- `Implemented`: in current build and evidenced.
- `Partial`: some supporting behavior exists, but requirement is not fully met.
- `Missing`: requirement not currently implemented.

| Req | Requirement | Current Build Status | Gap Summary | Build Requirement |
|---|---|---|---|---|
| Q5 | T+90 cron built/tested | Missing | Existing `retention:sweep` handles exports/tokens only; no project-closure-driven purge job. | Add nightly T+90 job keyed from canonical `closed_at`, with run logs and test coverage. |
| Q6 | Delete only re-identifiable fields at T+90 | Missing | No field-level anonymization policy exists for response/contact data. | Add identifier-vs-analytics field dictionary and anonymization routines. |
| Q7 | Cron dead-man switch + alerting | Missing | No heartbeat contract, no missed-run detector, no on-failure alerting path. | Add job heartbeat table + missed-run monitor + Slack/email webhook alert. |
| Q8 | Define project closure trigger and 90-day start | Partial | `pulse_sessions.closed_at` exists, but no canonical lifecycle policy or transition audit event stream. | Add lifecycle policy (`draft`, `active`, `paused`, `closed`) and immutable transition audit. |
| Q9 | Manual permanent deletion outside automated process | Partial | Deactivation/hard-delete behavior is mixed and not unified in a governed workflow. | Add privileged permanent-delete workflow with reason, approval, and immutable event log. |
| Q10 | Inactive-client archive flow + disposal | Missing | No inactivity archive automation, quarterly review process, or disposal schedule in code. | Add archive state machine, eligibility query, review report, and disposal controls. |
| Q14 | MFA for admin accounts with Tier-1 data access | Missing | Password + JWT only in current auth flow. | Add mandatory admin MFA with enrollment, challenge, and enforcement middleware. |
| Q15 | Immutable audit logs (not admin-editable), external sink, 7y retention | Missing | No dedicated immutable audit stream for security/compliance events. | Implement append-only audit pipeline with external sink and retention controls. |
| Q18 | Authenticated client dashboard access (magic link/token, scoped, <=24h, single-use) | Partial | Existing client access uses standard JWT login model, not scoped single-use dashboard token. | Implement purpose-bound client dashboard auth tokens with strict TTL and audit logging. |
| Q21 | CRM project status model + transition tracking, `closed_at` starts T+90 | Partial | Status concepts exist across entities, but no unified project lifecycle + transition log driving retention. | Define one canonical project lifecycle and make `closed_at` the retention trigger source. |
| Q22 | Overseas data handling controls | Missing | Compliance docs acknowledge legal/infra unknowns; code lacks respondent country/consent controls. | Add policy controls, metadata capture, transfer handling logic, and legal text references. |
| Q27 | Tier-3 7-year archive location/access/encryption | Missing | No dedicated Tier-3 archive architecture in app/infra docs. | Implement controlled archive storage model, encryption standards, access restrictions, lifecycle deletion. |
| Q28 | APP12/13 access/deletion requests with SLA and audit trail | Missing | No DSAR intake/workflow/SLA tracking or fulfillment audit model exists. | Add DSAR request pipeline (30-day SLA), fulfillment actions, and audit evidence. |

## 3) Required Architecture and Build Work

### Workstream A: Lifecycle and closure source of truth (Q8, Q21)

Objective: ensure the system has one auditable closure trigger that can safely drive retention jobs.

Build requirements:
- Add/standardize lifecycle states: `draft`, `active`, `paused`, `closed`.
- Keep canonical closure timestamp: `closed_at`.
- Record transition events with actor + timestamp + previous/new status.
- Ensure closure event is idempotent and cannot silently move backward without explicit admin action.

Primary touchpoints:
- `backend/src/migrations/`
- `backend/src/models/PulseSession.js`
- `backend/src/routes/admin.js`
- `backend/src/routes/platform/shared.js`

Acceptance criteria:
- Status transitions are enforced by API validation.
- Transition audit rows are written for every state change.
- `closed_at` is immutable once set unless a privileged reopen path is explicitly invoked and audited.

### Workstream B: T+90 anonymization engine + resilience (Q5, Q6, Q7)

Objective: safely anonymize re-identifiable fields after project closure, with operational guarantees.

Build requirements:
- Add nightly scheduled job for records where `closed_at <= now - 90 days`.
- Create field policy map:
  - Identifier fields to null/delete/hash.
  - Analytics-safe fields to retain.
- Execute in batches with dry-run mode, row counters, and per-run summary.
- Add heartbeat contract:
  - `last_run_at`, `status`, `duration_ms`, `records_scanned`, `records_anonymized`, `error_code`.
- Add alerting contract:
  - Immediate alert on run failure.
  - Alert if no successful run in 25 hours.

Primary touchpoints:
- `backend/src/services/retentionPolicy.js`
- `backend/src/jobs/retentionSweep.js`
- `render.yaml`
- Models under `backend/src/models/` related to invites/responses/users/contacts.

Acceptance criteria:
- Job runs nightly in production scheduler.
- A controlled test fixture demonstrates anonymization without breaking downstream analytics.
- Missed-run and run-failure alerts are verifiably triggered.

### Workstream C: Manual permanent deletion + immutable deletion log (Q9)

Objective: provide controlled manual deletion path outside automated retention.

Build requirements:
- Add privileged endpoint/service for manual permanent deletion.
- Require reason + confirmation payload.
- Add policy checks for legal-hold/archive exceptions.
- Write immutable deletion event for every request and every outcome.

Primary touchpoints:
- `backend/src/routes/platform/`
- `backend/src/services/`
- `backend/src/migrations/`

Acceptance criteria:
- Non-privileged users cannot trigger permanent deletion.
- Every deletion attempt (approved/denied/failed/success) is logged immutably.
- Legal-hold exception path blocks deletion and logs reason.

### Workstream D: Admin MFA + client dashboard auth hardening (Q14, Q18)

Objective: prevent high-risk account misuse and lock client dashboard entry to scoped, short-lived access.

Build requirements:
- Enforce MFA for all admin and super-admin-equivalent roles.
- Support enrollment + verification + recovery policy.
- Add dedicated client dashboard token flow:
  - Token bound to contact email + client/project scope.
  - Single-use token redemption.
  - Expiry <=24 hours.
  - Attempt/outcome audit event for every redemption.

Primary touchpoints:
- `backend/src/routes/auth.js`
- `backend/src/middleware/auth.js`
- `backend/src/models/User.js`
- `backend/src/security/`
- `frontend/src/pages/ClientHome.jsx`

Acceptance criteria:
- Admin login without second factor is rejected once MFA is required.
- Dashboard token cannot be reused.
- Expired or scope-mismatched tokens are rejected and logged.

### Workstream E: Immutable security audit architecture (Q15)

Objective: satisfy immutable audit requirements with long retention and admin tamper resistance.

Build requirements:
- Add audit event schema for auth, access, deletion, lifecycle, and DSAR actions:
  - `event_id`, `occurred_at`, `actor_id`, `actor_role`, `action`, `target_type`, `target_id`, `org_id`, `ip`, `user_agent`, `result`, `metadata`.
- Make application write path append-only for audit events.
- Forward events to external immutable sink with retention >= 7 years.
- Deny update/delete operations for audit events from normal admin roles.

Primary touchpoints:
- `backend/src/server.js` (middleware wiring)
- `backend/src/services/` (audit emitter)
- `backend/src/migrations/` (event table, optional outbox)
- `docs/compliance/` (retention and evidencing docs)

Acceptance criteria:
- Attempted mutation/deletion of audit events fails for app roles.
- External sink confirms ingestion and retention policy.
- Required audit fields are present for sampled events.

### Workstream F: Residency controls + APP12/13 DSAR workflow (Q22, Q28)

Objective: operationalize cross-border privacy obligations and participant rights handling.

Build requirements:
- Add respondent jurisdiction and consent metadata capture where required.
- Add DSAR workflow model and endpoints:
  - Request intake.
  - Identity verification status.
  - `due_at` calculation (30-day SLA).
  - Fulfillment outcome and completion timestamp.
- Add rule: deletion requests during T+90 window trigger manual immediate purge workflow.

Primary touchpoints:
- `backend/src/routes/pulseLink.js`
- `backend/src/models/`
- `backend/src/migrations/`
- `docs/compliance/`

Acceptance criteria:
- DSAR requests can be created, tracked, and fulfilled with full audit history.
- SLA breaches are detectable via query/report.
- Cross-border policy and capture fields are documented and test-covered.

### Workstream G: Tier-3 archive and 7-year disposal operations (Q10, Q27)

Objective: provide controlled long-term archive and compliant disposal process.

Build requirements:
- Define archive eligibility policy (inactive >=12 months and closed).
- Implement archive state, archive metadata, and disposition schedule.
- Restrict archive access to super-admin class and log every access action.
- Define storage controls:
  - Encryption at rest standard (AES-256 equivalent).
  - Lifecycle policy for deletion at 7-year mark.
- Produce quarterly review report for nearing-disposal records.

Primary touchpoints:
- `backend/src/models/`
- `backend/src/routes/platform/`
- `render.yaml` and infra policy docs
- `docs/compliance/`

Acceptance criteria:
- Archive promotion and disposal are auditable and reproducible.
- Quarterly report output exists and is reviewable by compliance owner.
- Archive access attempts are logged and access-controlled.

## 4) Detailed To-Do Checklist (Execution Order)

### Phase 1: Foundation and schema
- [ ] Define canonical lifecycle policy doc and entity ownership.
- [ ] Add migration for lifecycle expansion and transition event table.
- [ ] Add migration for audit event pipeline tables.
- [ ] Add migration for DSAR request tables and SLA fields.
- [ ] Add migration for archive metadata and state fields.

### Phase 2: Core backend controls
- [ ] Implement lifecycle transition service with actor capture.
- [ ] Implement T+90 anonymization job with dry-run mode.
- [ ] Implement heartbeat writer and missed-run detection query.
- [ ] Implement manual permanent-delete service and policy exceptions.
- [ ] Implement immutable audit emitter middleware.

### Phase 3: Authentication/security controls
- [ ] Implement admin MFA enrollment/challenge/recovery.
- [ ] Enforce MFA requirement on privileged routes.
- [ ] Implement client dashboard scoped token issuance/redemption flow.
- [ ] Add login, token redemption, and auth failure audit events.

### Phase 4: Privacy operations and archive
- [ ] Implement DSAR intake + triage + fulfillment workflow.
- [ ] Add immediate manual purge handoff for eligible deletion requests.
- [ ] Implement archive eligibility evaluator and archive transitions.
- [ ] Add quarterly archive/disposal report job and output format.
- [ ] Publish operator runbooks for retention, DSAR, and archive actions.

### Phase 5: Verification and release evidence
- [ ] Add automated tests for lifecycle, T+90 anonymization, and DSAR SLA calculations.
- [ ] Add negative tests for unauthorized delete/audit mutation attempts.
- [ ] Run end-to-end auth tests for admin MFA and client token flows.
- [ ] Validate scheduler, heartbeat, and alerting in staging.
- [ ] Produce requirement evidence pack for sign-off.

## 5) Verification Gates (100% Coverage)

Do not mark requirement coverage complete until all gates pass:

1. Requirement mapping gate
- Every requirement ID (Q5, Q6, Q7, Q8, Q9, Q10, Q14, Q15, Q18, Q21, Q22, Q27, Q28) maps to:
  - one implementation owner,
  - one code/config control,
  - one verification artifact.

2. Build gate
- All required migrations/services/routes are merged.
- No open `Missing` status remains in the matrix.

3. Security/compliance gate
- MFA enforced for privileged users in production policy.
- Immutable audit log controls and retention confirmed.
- DSAR workflow and SLA monitoring operating.

4. Operational gate
- Nightly T+90 job runs with heartbeat.
- Alerting is tested for failure and missed-run cases.
- Archive quarterly report process is operational.

5. Evidence gate
- Test reports, run logs, and policy references are attached.
- Compliance/legal approves unresolved policy items or signs exceptions.

## 6) Required Evidence Pack for Client/Compliance Sign-off

- Requirement coverage matrix with implementation references.
- Migration IDs and deployment dates for privacy controls.
- Redacted job-run summaries for T+90 and archive workflows.
- Audit event schema and sample event extracts.
- MFA enforcement proof (policy + test evidence).
- DSAR SLA report output and one completed request trace.
- Storage/retention attestation for 7-year audit and Tier-3 lifecycle.

## 7) Risks and Dependency Notes

- Legal and infrastructure decisions are required for cross-border handling and archive storage controls.
- Archive and immutable-log controls may need cloud-provider configuration outside app code.
- Introducing hard privacy constraints without staged rollout can break reporting flows; use dry-run and staged migration gates.

## 8) Immediate Next Actions

1. Review and approve this build specification with Engineering + Compliance + Infra.
2. Break workstreams into implementation PRs:
   - PR1: lifecycle + transition audit,
   - PR2: T+90 engine + heartbeat + alerts,
   - PR3: MFA + client dashboard token flow,
   - PR4: immutable audit pipeline + DSAR workflow,
   - PR5: archive/disposal operations + reporting.
3. Begin Phase 1 schema work and attach evidence to this document as controls are completed.
