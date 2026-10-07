-- Rollback for 0007_privileged_audit.sql.
-- Apply this before the 0006 rollback.

BEGIN;

DROP TABLE IF EXISTS privileged_audit;
DROP FUNCTION IF EXISTS privileged_audit_append_only();

COMMIT;
