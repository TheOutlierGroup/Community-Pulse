-- Ensure privacy requests always start in a valid workflow state.
ALTER TABLE privacy_requests
  ALTER COLUMN status SET DEFAULT 'received';
