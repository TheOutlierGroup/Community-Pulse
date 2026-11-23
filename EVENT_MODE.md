# Event mode

A temporary, per-client presentation layer for Rhythm Engine, built for a launch event. It changes how the survey and dashboards look and read for one client, and changes nothing while switched off.

## Turning it on

Two switches must both be on:

1. **Server:** `EVENT_MODE_AVAILABLE=true` in the backend environment of **both** web services (`pulse-crm-web` and `pulse-app-web`). Off by default.
2. **Client:** platform staff open the client's **Rhythm Engine → Configurations → Event mode** tab (in either the CRM or the Rhythm Engine app) and use **Turn on**. The tab is only shown to platform staff, and the API enforces the same rule. The client logo can be uploaded from the same tab.

There is no automatic end date. Turning the toggle off restores the standard experience immediately and keeps all Event mode settings, so turning it back on restores the full setup.

## What it changes

| Area | With Event mode on |
|---|---|
| Survey header | Client logo (from the existing client logo upload), client colours, change name as the heading |
| Survey welcome | Change context block (what's changing, why we're asking, how feedback is used, when they'll hear back), confidentiality line (minimum group size of 5), time to complete |
| Survey questions | Approved reworded statements (`event-v1`) with one bolded key phrase each, progress bar and "Section 2 of 4 · Questions 5 to 8 of 16 · about 4 minutes left", halfway note, collapsible "Why this survey" |
| Thank-you screen | What happens next and when they'll hear back |
| Invites | Cannot be sent for a stage until that stage's change context and the change name are filled in |
| Dashboards | Same views, summarised: compact branded header, plain-English labels and actions, team lists capped at the 5 most at risk ("View all" shows the rest), theme summary instead of every statement |

Brand colours never replace the red, amber and green status colours. Text colour on buttons is chosen automatically, and light brand colours are darkened automatically when used as text.

## Data recorded

Each completed link response stores `wording_version` (`current` or `event-v1`), so results gathered under the reworded statements can be told apart from the original wording when comparing stages. Migration: `087_pulse_link_response_wording_version.sql`.

## Not covered

- The signed-in employee survey (`/rhythm-engine` for users with an app account) keeps the standard wording; Event mode applies to the personal-link survey.
- Downloaded Word and PDF reports, AI-generated signal text and invite emails are unchanged.
- Trend Analysis is unchanged.

## Removing it

The feature is isolated in:

- `backend/src/services/eventMode.js`, `backend/src/services/eventModeWording.js`
- `frontend/src/components/platform/EventModePanel.jsx`, `frontend/src/styles/eventMode.css`
- `frontend/src/utils/eventModeTheme.js`, `eventModeDashboard.js`, `eventSurvey.js`

plus `eventActive` / `isEvent` branches in `PublicPulse.jsx`, `PlatformClientPulse.jsx`, `pulseLink.js` and the two Event mode routes in `orgRoutes.js`. Settings live under `organizations.settings.eventMode`.

## Fixes shipped for everyone (not behind Event mode)

- "These set of questions" grammar fix
- Scale words shown under every 1 to 5 button; "Neutral" renamed "Neither agree nor disagree"; sentence case
- "Unanswered" label removed; missed statements are highlighted and scrolled to
- Survey intros say "confidential" instead of "anonymous"
- Staff thank-you screen uses the stage-specific message
- Long dashes removed from the expired-link message and "Insufficient data" text

## Related: small-organisation minimum group size

Separate from Event mode. Outlier admins (platform org, admin role) can turn on **Configurations → Respondents → "Small organisation: report groups of 3 or more"** for a client. Nobody else sees or can change it (API enforced, audit logged as `org.small_org_minimum.update`).

- Each link response records the minimum that respondent was told (`pulse_link_responses.promised_min_group_size`, migration 089).
- Dashboards and reports use the strictest promise in each group: responses from before this existed, and signed-in employee responses, count as 5.
- So it only lowers the minimum for survey stages that start after it is turned on. A stage already underway keeps telling new respondents 5 and keeps reporting at 5.
- The survey's confidentiality line, and any welcome text saying "groups of 5 or more", show the minimum actually promised.
- Turning it off returns every result to 5 immediately.
