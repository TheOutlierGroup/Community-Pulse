# CRM Validation Response Pack

Use this worksheet to answer the open questions in `CRM_Understanding_Validation_Document.docx`.

## Status Legend

- `Confirmed from code`: verified directly in repository behavior.
- `Needs infra confirmation`: requires deployment/provider dashboard evidence.
- `Needs legal/compliance decision`: requires policy/legal owner decision.

## Open Question Responses

| # | Question | Current Answer | Status | Evidence / Source | Owner | Next action |
|---|---|---|---|---|---|---|
| 1 | What is the exact hosting provider and server location for the CRM? | Render is the deployment target in config; exact region is not encoded in app code. | Needs infra confirmation | `render.yaml`, `backend/src/services/complianceInventory.js`, `/api/platform/compliance/inventory` | Infra/DevOps | Record production service + DB region from provider console. |
| 2 | Will any data be processed or stored through overseas cloud infrastructure? | Possible depending on provider region/sub-processors; not determinable from code alone. | Needs infra confirmation | `/api/platform/compliance/inventory` unknowns section | Infra + Legal | Confirm region, backup region, and vendor transfer terms. |
| 3 | What third-party integrations are planned (email, LinkedIn, etc.)? | Resend email integration is implemented. No LinkedIn integration found in current code. | Confirmed from code | `backend/src/services/email.js`, `backend/.env.example`, `backend/src/services/complianceInventory.js` | Product + Engineering | Confirm if LinkedIn is roadmap only or required now. |
| 4 | How does the survey tool technically attach to a CRM contact profile? | Via org-scoped sessions and CRM→Pulse handoff token flow; no external CRM contact-id mapping table exists. | Confirmed from code | `backend/src/routes/platform/orgRoutes.js`, `backend/src/routes/auth.js`, `backend/src/security/pulseHandoffToken.js` | Engineering | Keep wording as org/user/invite linkage rather than external contact sync. |
| 5 | What data fields are currently shared between the CRM and survey tool? | Session-linked response payloads are unified through the response contract service (`employee` + `pulse_link` cohorts by default). | Confirmed from code | `backend/src/services/pulseDataContract.js`, `backend/src/routes/analytics.js`, `backend/src/routes/admin.js` | Engineering | Publish API-facing field list for stakeholder review. |
| 6 | Will records be permanently deletable from the CRM? | Mixed behavior today: some entities hard-delete; users are deactivated. Retention sweep now handles exports and expiring token tables. | Confirmed from code + policy decision pending | `backend/src/models/User.js`, `backend/src/services/retentionPolicy.js`, `backend/src/jobs/retentionSweep.js` | Engineering + Compliance | Approve full deletion policy (hard delete vs archive by entity class). |
| 7 | How is access to the survey dashboard authenticated? | JWT auth with org/role middleware and optional CRM→Pulse handoff token exchange. | Confirmed from code | `backend/src/middleware/auth.js`, `backend/src/routes/auth.js`, `backend/src/routes/platformRouter.js` | Engineering | Add this summary to client-facing security docs. |
| 8 | Will the CRM track deal/pipeline stages and project status? | Task workflow statuses exist; dedicated sales-pipeline/deal entities are not implemented. | Confirmed from code | `backend/src/models/ClientWorkTask.js`, `frontend/src/pages/PlatformClientTasks.jsx` | Product + Engineering | Confirm whether task statuses are sufficient or if a deal model is required. |
| 9 | How will the system handle data for overseas clients or survey respondents? | Application supports data capture agnostic of geography; cross-border obligations depend on hosting/vendor choices and privacy policy controls. | Needs legal/compliance decision | `docs/compliance/crm-data-footprint.md`, `/api/platform/compliance/inventory` | Legal + Infra + Product | Define offshore transfer controls and notice language before launch in overseas markets. |

## Additional Notes for LF Review

- Platform employee access is now scoped to assigned client organizations.
- Platform admins retain full client-org access.
- Survey response endpoints now return `responseContract` metadata so stakeholders can see which cohorts are included.
- Retention controls are now configurable and runnable via `npm run retention:sweep` in `backend/`.
