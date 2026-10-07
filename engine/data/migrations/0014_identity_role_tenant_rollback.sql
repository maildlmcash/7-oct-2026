-- Rollback for 0014_identity_role_tenant.sql.
-- Apply this before 0006_role_definitions_rollback.sql and before 0001_checklist_entities_rollback.sql.

BEGIN;

DROP TRIGGER IF EXISTS identity_role_assignment_cycle ON identity_role_assignment;
DROP TRIGGER IF EXISTS identity_role_assignment_combined ON identity_role_assignment;
DROP TABLE IF EXISTS identity_capability_rule;
DROP TABLE IF EXISTS identity_role_assignment;
DROP TABLE IF EXISTS identity_principal;
DROP TABLE IF EXISTS identity_capability;
DROP FUNCTION IF EXISTS identity_reject_assignment_cycle();
DROP FUNCTION IF EXISTS identity_combined_roles();
DROP TRIGGER IF EXISTS tenant_parent_cycle ON tenant;
DROP FUNCTION IF EXISTS identity_reject_tenant_cycle();
ALTER TABLE tenant DROP CONSTRAINT IF EXISTS tenant_parent_fk;
ALTER TABLE tenant DROP CONSTRAINT IF EXISTS tenant_status_known;
ALTER TABLE tenant DROP CONSTRAINT IF EXISTS tenant_parent_not_self;
ALTER TABLE tenant DROP COLUMN IF EXISTS parent_id;
ALTER TABLE tenant DROP COLUMN IF EXISTS status;

COMMIT;
