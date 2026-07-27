-- PT-02: give public survey link tokens an expiry.
--
-- pulse_link_invites has carried a token_hash since migration 014 with no
-- expiry column and no purge anywhere in the retention sweep, so every
-- survey link ever emailed stayed valid indefinitely. The only time bound
-- was the optional per-org settings.pulseInviteDueDates, which is unset by
-- default. A forwarded email or a departed employee's mailbox was a
-- permanent credential into that client's survey.

ALTER TABLE pulse_link_invites
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

-- Backfill every token that exists today.
--
-- Two competing needs: bound the legacy tokens, and don't cut off a wave
-- that is currently in the field. GREATEST does both — a token is valid
-- until 90 days after it was last sent, but never less than 30 days from
-- this migration running. So nothing that works today stops working on
-- deploy, while every existing link acquires a hard ceiling instead of
-- running forever. Admins can re-send at any point to mint a fresh token
-- (rotateTokenAndMarkSent), which resets the window.
--
-- Scoped to rows that actually hold a token: an invite created but never
-- sent has token_hash IS NULL and cannot be redeemed regardless.
UPDATE pulse_link_invites
SET expires_at = GREATEST(
      COALESCE(last_invited_at, updated_at, created_at) + INTERVAL '90 days',
      NOW() + INTERVAL '30 days'
    )
WHERE token_hash IS NOT NULL
  AND expires_at IS NULL;

-- Supports both the redemption lookup and the retention sweep's scan for
-- long-expired tokens. Partial, since untokened rows are never consulted.
CREATE INDEX IF NOT EXISTS idx_pulse_link_invites_expires_at
  ON pulse_link_invites (expires_at)
  WHERE token_hash IS NOT NULL;
