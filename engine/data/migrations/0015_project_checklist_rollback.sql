-- Rollback for 0015_project_checklist.sql.
-- Apply this before 0001_checklist_entities_rollback.sql.
-- It does not drop tenant or checklist_item.

BEGIN;

DROP TRIGGER IF EXISTS project_check_issue_no_update ON project_check_issue;
DROP TRIGGER IF EXISTS project_check_no_update ON project_check;
DROP TRIGGER IF EXISTS project_check_before_insert ON project_check;
DROP FUNCTION IF EXISTS project_check_issue_immutable();
DROP FUNCTION IF EXISTS project_check_immutable();
DROP FUNCTION IF EXISTS project_check_before_insert();
DROP TABLE IF EXISTS project_check_issue;
DROP TABLE IF EXISTS project_check;
DROP TABLE IF EXISTS project_check_template;

COMMIT;
