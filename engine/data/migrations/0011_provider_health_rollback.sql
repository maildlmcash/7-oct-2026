-- Rollback for 0011_provider_health.sql.
-- Apply this before the 0010 rollback. It does not drop privileged_audit.

BEGIN;

DROP TABLE IF EXISTS provider_health;
DROP FUNCTION IF EXISTS provider_health_append_only();

COMMIT;
