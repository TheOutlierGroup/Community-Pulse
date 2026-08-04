-- Carries the requester's existing MFA verification state across the
-- CRM -> Rhythm Engine handoff.
--
-- The handoff-exchanged session token used to be minted with no
-- mfaVerifiedAt claim at all, regardless of the CRM session's actual
-- state. Every admin action gated by requirePlatformAdminRole (creating a
-- During checkpoint, and everything else admin-only on the Rhythm Engine
-- surface) therefore failed for every admin who reached it the normal
-- way -- via the CRM's silent handoff redirect -- with no way to recover
-- short of a direct sign-in on the Rhythm Engine domain itself.
--
-- Storing it on the handoff token (rather than, say, re-deriving it at
-- exchange time) keeps the exchanged token's claim equal to what the CRM
-- session actually had at the moment the handoff was requested: fresh
-- stays fresh, stale stays stale, absent stays absent. No downgrade, no
-- free pass either way.
ALTER TABLE pulse_handoff_tokens
  ADD COLUMN IF NOT EXISTS mfa_verified_at TIMESTAMPTZ;
