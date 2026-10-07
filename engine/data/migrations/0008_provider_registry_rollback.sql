-- Rollback for 0008_provider_registry.sql.
-- Apply this before the 0001 rollback. It does not drop tenant or privileged_audit.

BEGIN;

DROP TABLE IF EXISTS provider_registry;
DROP FUNCTION IF EXISTS provider_registry_immutable();
DROP FUNCTION IF EXISTS provider_registry_lineage();

COMMIT;
