-- Rollback for 0001_checklist_entities.sql.
-- This drops the checklist tables and their functions. It does not keep rows.
-- It does not drop objects outside this migration.

BEGIN;

DROP TABLE IF EXISTS audit_record;
DROP TABLE IF EXISTS evidence;
DROP TABLE IF EXISTS check_run;
DROP TABLE IF EXISTS finding;
DROP TABLE IF EXISTS checklist_item;
DROP TABLE IF EXISTS checklist_template;
DROP TABLE IF EXISTS project;
DROP TABLE IF EXISTS tenant;

DROP FUNCTION IF EXISTS checklist_audit_append_only();
DROP FUNCTION IF EXISTS check_run_requires_finding();
DROP FUNCTION IF EXISTS checklist_item_requires_finding();

COMMIT;
