# TODO

Gap tracking for the Change Readiness Survey Tool logic vs current implementation.

## Done

- [x] Recommendation mapping exists and is deterministic by quadrant in `backend/src/services/pulseEngine.js`.
- [x] Manager load scoring and load-band inversion are implemented with boundary coverage in `backend/src/services/pulseEngine.js` and `backend/src/services/pulseEngine.test.js`.
- [x] Score threshold boundary uses `>= 28` for adoption and sponsorship in `backend/src/services/pulseEngine.js`.
- [x] Manager/no-manager aggregate paths are null-safe in the dashboard API and UI (`backend/src/routes/platform/orgRoutes.js`, `frontend/src/pages/PlatformClientPulse.jsx`).
- [x] Dimension labels corrected to doc word-for-word: dim 2C manager `'Implementation Autonomy'`, dim 2D manager `'Manager Wellbeing'` in `backend/src/services/pulseEngine.js`.
- [x] Recommendation copy corrected to doc word-for-word: `motivated_lost`, `capable_wary`, `high_risk` strings in `backend/src/services/pulseEngine.js`.
- [x] Verdict headline uses title case matching doc (`'Cleared for Launch'` / `'Not Cleared for Launch'`) in `backend/src/services/pulseDashboardMetrics.js`.
- [x] Sponsorship Declining alert (doc §6 priority 2): fires when sponsorship drops > 1.0 pt period-on-period — implemented in `pulseDashboardMetrics.js`, wired in `orgRoutes.js`.
- [x] Dimension Floor alert (doc §6 priority 3): fires when any dimension avg < 2.5/5.0 — implemented in `pulseDashboardMetrics.js`, wired in `orgRoutes.js`.
- [x] Adoption Rising alert condition tightened to require `adoptionDelta > 0` in addition to `>= 28` threshold, matching doc §6 priority 5.
- [x] Add explicit dashboard field semantics for averaging and period/delta reference, then render that context in the Pulse UI.
- [x] Implement threshold-crossed alert using prior persisted wave scores with deterministic first-run behavior (no alert on missing previous wave).
- [x] Expand alert engine to deterministic priority + cap behavior (max 5) with overflow count support.
- [x] Make quadrant and load distribution percentages sum to exactly 100% at display time using largest-remainder correction.
- [x] Add data-coverage indicators in dashboard payload/UI (manager presence, manager assignment coverage, suppressed team comparability).
- [x] Add verdict/headline copy-state handling so static copy cannot conflict with computed score state.
- [x] Regression tests for new alert functions (`buildSponsorshipDecliningAlert`, `buildDimensionFloorAlerts`, `headlineForVerdict`) in `pulseDashboardMetrics.test.js`.

## Missing / Needs Alignment

- [ ] Finalize and document org-level averaging strategy (pooled respondents vs explicit cohort blend) and enforce one canonical approach across API payload fields in `backend/src/routes/platform/orgRoutes.js`.
- [x] Standardize period semantics: trend and delta now use rolling 7-day submission-time buckets (4 weeks, most recent first) instead of session-wave order — `backend/src/routes/platform/orgRoutes.js`.

## Build / Verification

- [ ] Run backend tests and frontend build after each gap closure PR.
