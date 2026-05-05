-- SUP-02 follow-up: the dedicated `support_tickets` table from the
-- (now deleted) migration 042 is replaced by reusing the existing CRM
-- task board. Licensees submit support requests via the in-app widget
-- and the backend creates a card on that licensee's task board, so
-- platform staff triage them alongside everything else for that account.
--
-- This migration drops the legacy table on any environment that
-- happened to apply 042 before it was removed. It's safe to run on
-- fresh databases (no-op via IF EXISTS).

DROP TABLE IF EXISTS support_tickets CASCADE;
