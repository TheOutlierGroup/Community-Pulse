# Pulse

**Pulse** is an organisational diagnostic product for measuring how teams experience work—readiness for change, leadership credibility (sponsorship), friction and energy across themes, and manager load. It is designed for consultancies and internal transformation teams who run structured “waves” of listening with clients, then review results in a single place.

Outlier uses this codebase (also mirrored as **Community Pulse**) to support **client organisations** on the platform: running Pulse sessions, inviting participants, and reviewing dashboards without treating Pulse as a generic survey tool.

---

## What it does

- **Pulse questionnaire** — A guided, multi-step flow (work feel, priorities, energy, context, reflection) aligned to a consistent theme model so scores and narratives are comparable across teams and over time.
- **Session waves** — Client admins define **Pulse sessions** (draft → active → closed). Separate **staff** and **manager** audiences let the same diagnostic run on parallel tracks so reporting stays clean (employees vs managers, including people who only participate via email link).
- **Link-based participation** — People can complete Pulse with a **personal link** (no app account). CSV import can tag each recipient as **staff** or **manager** so their link attaches to the correct active session for that audience.
- **Signed-in participation** — Employees in a client org complete Pulse inside the app against the active **staff** session.
- **Analytics and narrative** — Organisation-level views combine responses for adoption/sponsorship scores, quadrant distribution, dimension breakdowns, manager load bands, trend across recent waves, and alert-style signals—oriented to rollout and risk conversations, not just raw charts.

---

## Who uses it

| Role | Purpose |
|------|--------|
| **Platform (Outlier)** | Manage client organisations, enable services, open each client’s Pulse dashboard (scores, breakdowns, manager load, team-level views), configure link recipients, and work client tasks alongside other delivery workflows. |
| **Client admin** | Create and activate Pulse sessions (per audience where needed), invite team members to the client org, and use admin analytics for a given session. |
| **Client employee** | Complete the Pulse flow when a session is live. |
| **Link-only participant** | Completes Pulse via email link; counted and segmented by **staff** / **manager** for participation and dashboards. |

---

## Product surface (at a glance)

- **Platform client workspace** — Per-client dashboard, users, tasks, account, and **Pulse** with sectioned views (full organisation overview vs focused views for scores, employee breakdown, team-level sample, manager load).
- **Client admin** — Session lifecycle, invites, and session-scoped analytics.
- **Employee** — Pulse completion and reflection.
- **Public Pulse link** — Tokenised access tied to an invite and organisation; respects Pulse service flags and active session for that invite’s role.

---

## Stack (for orientation)

Node.js (Express), PostgreSQL, React (Vite). This README describes **what the product is**; environment and deployment details live in `backend/.env.example`, `build.sh`, and `render.yaml` for teams who run or ship it.

---

## License

Private / your organisation.
