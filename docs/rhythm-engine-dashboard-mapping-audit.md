# Rhythm Engine Dashboard Mapping Audit

## Scope

This audit checks whether dashboard mapping logic in the codebase matches:

- `/Users/lukeford/Downloads/Survey Question & Dashboard Mapping Logic 2026 03 25[63].html`
- `/Users/lukeford/Downloads/Adoption Pulse - Product Requirements [Updated] 2026 03 25[78].docx`

And whether the dashboard uses only real live data (no dummy, placeholder, or fallback content).

## Code Areas Audited

- `backend/src/routes/platform/orgRoutes.js`
- `backend/src/services/pulseEngine.js`
- `backend/src/services/pulseDashboardMetrics.js`
- `backend/src/services/pulseDataContract.js`
- `backend/src/services/pulseSoWhatSummary.js`
- `backend/src/routes/platformRouter.js`
- `frontend/src/pages/PlatformClientPulse.jsx`

## Canonical Mapping Logic (from attached specs)

### Survey scoring model

- Items are Likert 1-5.
- Employee:
  - Adoption = `Q1..Q8` (sum, 8-40)
  - Sponsorship = `Q9..Q16` (sum, 8-40)
- Manager:
  - Adoption = `MQ1..MQ8` (sum, 8-40)
  - Sponsorship = `MQ9..MQ16` (sum, 8-40)
- Manager load = `MQ5 + MQ6 + MQ15 + MQ16` (sum, 4-20)

### Thresholds and states

- Threshold for high/low readiness = `28/40`.
- Quadrants from Adoption/Sponsorship highs/lows:
  - Optimal
  - Motivated but Lost
  - Capable but Wary
  - High Risk
- Manager load bands:
  - Sustainable: 16-20
  - Stretched: 11-15
  - At Capacity: 6-10
  - Overloaded: 4-5

### Required dashboard sections

- KPI strip (counts, participation, adoption/sponsorship scores + deltas)
- Org score context and quadrant distribution
- Manager load distribution
- Dimension heatmap/table
- Trend view
- System alerts
- Team-level view
- Sponsorship analysis detail

## Codebase Mapping (implementation)

### Data pipeline

1. Dashboard request enters `GET /organizations/:id/pulse-dashboard` in `backend/src/routes/platform/orgRoutes.js`.
2. API alias `/api/platform/organizations/:id/rhythm-engine-dashboard` rewrites to that route in `backend/src/routes/platformRouter.js`.
3. Response rows are loaded via `listSessionResponses()` in `backend/src/services/pulseDataContract.js`.
4. Scoring is computed by `scoreResponseFromSteps()` in `backend/src/services/pulseEngine.js`.
5. Aggregations (kpis, quadrants, dimensions, manager sections, alerts, soWhat) are assembled in `backend/src/routes/platform/orgRoutes.js`.
6. Frontend renders in `frontend/src/pages/PlatformClientPulse.jsx`.

### Backend response -> frontend block mapping

- `kpis.*` -> top KPI strip, bridge cards, launch badge/headline usage
- `quadrants[]` -> executive quadrant tiles
- `alerts[]` -> readiness alert cards and system alert list
- `dimensions[]` -> employee/manager dimension tables
- `byManager[]` -> manager load distribution, chain distribution display, team/group view
- `sponsorshipAnalysis.signals` -> sponsorship signal text snippets
- `soWhat` / `narrative` -> executive summary paragraph (when present)
- `trend` -> currently not effectively used for populated trend display

## Live Data Classification

### Live (DB-backed direct values)

- Response counts, invited counts, participation percentages
- Completed employee/manager counts
- Org/session-selected scored response sets
- Manager and team rollups based on actual response data

### Derived live (computed from live responses)

- Adoption/Sponsorship scores
- Quadrant classification percentages
- Dimension averages / high percentages
- Manager load bands and related percentages
- Most alert triggers based on current/derived metric values

### Non-live / fallback / template usage currently present

- Executive narrative fallback text in frontend (`fallbackExecutiveSignal` in `frontend/src/pages/PlatformClientPulse.jsx`)
- Scenario narrative blocks are template text with interpolated metrics in frontend
- KPI bridge narrative fallback text is template text in frontend
- Empty-state and unavailable-state copy in frontend
- Backend so-what summary fallback behavior when AI summary call fails (`backend/src/services/pulseSoWhatSummary.js` + route handling in `backend/src/routes/platform/orgRoutes.js`)
- Static rule text/templates in `backend/src/services/pulseDashboardMetrics.js`

## Strict Requirement Check: "Only real live data, no dummy/placeholder/fallback"

## Verdict

Not fully compliant with strict live-only requirements.

### Confirmed gaps

1. Frontend executive/scenario/bridge narrative currently includes template/fallback text, not purely backend live fields.
2. `trend` is initialized but not populated with historical values in `backend/src/routes/platform/orgRoutes.js`, so true live trend/delta behavior is incomplete.
3. Frontend sponsorship chain presentation is partially re-derived from `byManager` quadrant mapping instead of fully binding to backend `sponsorshipAnalysis` structures end-to-end.
4. Empty-state/fallback text paths remain active in dashboard rendering.

## What is correct today

- Core score mapping from survey answers to adoption/sponsorship metrics is aligned with the attached mapping logic.
- Threshold and quadrant logic are implemented and used with live scored rows.
- Manager load computation uses live manager response data and configured bands.
- Dashboard primary numeric KPIs are live or derived-live from live submissions.

## Priority Remediation Backlog (to reach strict live-only)

1. Remove frontend narrative fallbacks; render executive/scenario copy from backend live-computed fields only.
2. Implement real trend aggregation in `orgRoutes` and remove trend/delta placeholders.
3. Bind sponsorship chain UI directly to backend `sponsorshipAnalysis` matrix/state payloads.
4. Gate or remove non-live empty/fallback content in production strict mode.
5. Add a runtime safeguard/test that fails if dashboard payload falls back to template text in strict mode.

