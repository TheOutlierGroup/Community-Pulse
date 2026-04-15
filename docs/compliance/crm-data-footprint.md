# CRM Data Footprint

This document provides an implementation-facing inventory for CRM/Pulse privacy and hosting validation.

## Current deployment surfaces

- `APP_SURFACE` supports `crm`, `pulse`, and `all`.
- Platform APIs are always mounted behind authenticated platform users.
- Pulse APIs are omitted when running `APP_SURFACE=crm`.

## Storage and data-at-rest

- Application files are stored under `STORAGE_PATH`.
- Export files are written to `${STORAGE_PATH}/exports`.
- Uploads are written to `${STORAGE_PATH}/uploads` (`avatars`, `org-logos`, `task-images`).
- Export and token retention are controlled by:
  - `EXPORT_RETENTION_DAYS` (default `30`)
  - `TOKEN_RETENTION_DAYS` (default `30`)

## Integrations/processors currently configured in code

- Resend (`RESEND_API_KEY`) for transactional email delivery.
- Render-hosted runtime (`RENDER=true`) in production deployments.
- Google Fonts loaded by frontend asset bundle.

## Geography and offshore handling

- App code does not set cloud region directly.
- Region and backup/replication geography are controlled in infrastructure provider settings.
- Cross-border transfer obligations must be validated against production provider region and vendor sub-processors.

## Runtime evidence endpoint

- `GET /api/platform/compliance/inventory`
- Returns generated inventory snapshot:
  - Surface and URL configuration
  - Storage path class
  - Integration flags
  - Retention policy values
  - Explicit unknowns requiring infrastructure/legal confirmation
