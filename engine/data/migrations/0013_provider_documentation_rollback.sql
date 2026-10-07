-- Rollback for 0013_provider_documentation.sql.
-- Apply this before the 0012 rollback. It does not drop privileged_audit.

BEGIN;

DROP TABLE IF EXISTS provider_documentation;
DROP FUNCTION IF EXISTS provider_documentation_append_only();

COMMIT;
