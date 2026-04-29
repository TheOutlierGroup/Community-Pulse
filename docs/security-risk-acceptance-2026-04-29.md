# Security Risk Acceptance Notes (2026-04-29)

Date: 2026-04-29  
Scope: Employee Pulse backend/frontend production dependencies and penetration baseline

## Summary

Security baseline and scripted abuse checks passed for this cycle. Remaining unresolved dependency advisories are tracked below with mitigation and ownership notes.

## Open Dependency Risks

### 1) `xlsx` (frontend) - High
- Advisory class: Prototype pollution / ReDoS
- Current status: No upstream fix available in the current dependency line.
- Exposure context:
  - Package is used for import/export data handling.
  - Inputs are expected from authenticated users in controlled workflows.
- Mitigation in place:
  - Maintain strict server-side validation of imported content.
  - Restrict import access to authenticated/authorized users.
  - Monitor upload volume and suspicious payload patterns.
- Acceptance decision:
  - **Accepted temporarily** until upstream fix is available.
- Owner: Engineering
- Review trigger:
  - Re-check on each dependency update cycle or within 30 days.

### 2) `path-to-regexp` transitive risk (backend) - High
- Advisory class: Potential ReDoS on vulnerable versions.
- Current status: `npm audit fix` available for non-breaking path.
- Mitigation in place:
  - Existing route patterns are bounded and do not accept arbitrary regex from user input.
  - Platform rate limiting is enabled.
- Acceptance decision:
  - **Accepted temporarily** pending coordinated dependency update and regression pass.
- Owner: Engineering
- Target remediation:
  - Schedule dependency refresh in next security maintenance cycle.

### 3) `uuid` transitive risk via `resend/svix` (backend) - Moderate
- Advisory class: Buffer bounds check issue in specific code paths.
- Current status: Fix requires breaking major upgrade path (`uuid@14`) through transitives.
- Mitigation in place:
  - Current usage path is constrained and not fed by untrusted buffer inputs directly.
- Acceptance decision:
  - **Accepted temporarily** until compatible upstream chain supports safe upgrade.
- Owner: Engineering
- Review trigger:
  - Re-check with each `resend`/`svix` update.

### 4) `axios`, `dompurify`, `follow-redirects` (frontend) - Moderate
- Advisory class: SSRF/header propagation edge cases and sanitization bypass variants.
- Current status: `npm audit fix` available for patch-level updates.
- Mitigation in place:
  - Frontend requests target known API origins.
  - Rendering paths rely on existing sanitization and controlled rich text handling.
- Acceptance decision:
  - **Accepted short-term** with planned patch update in next dependency refresh pass.
- Owner: Engineering
- Target remediation:
  - Apply non-breaking audit fixes and rerun frontend regression/e2e.

## Sign-off Notes

- This document records temporary risk acceptance for unresolved upstream or deferred dependency fixes.
- Acceptance is conditional on:
  1. Monthly dependency review cadence,
  2. Immediate reevaluation if threat intelligence or exploitability changes,
  3. Completion of remaining manual privilege-escalation checks and authenticated DAST when tooling/credentials are available.
