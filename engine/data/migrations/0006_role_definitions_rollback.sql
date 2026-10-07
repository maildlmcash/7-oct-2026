-- Rollback for 0006_role_definitions.sql.
-- Apply this before the 0005 rollback. It removes role names only.

BEGIN;

DROP TABLE IF EXISTS role_definition;

COMMIT;
