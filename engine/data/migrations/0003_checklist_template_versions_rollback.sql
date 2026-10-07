-- Rollback for 0003_checklist_template_versions.sql.
-- Apply this before 0002 and 0001 rollbacks.
-- Dropping the columns removes lineage and retired markers on existing template rows.

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.checklist_template') IS NULL THEN
    RETURN;
  END IF;

  DROP TRIGGER IF EXISTS checklist_template_lineage ON checklist_template;
  DROP FUNCTION IF EXISTS checklist_template_lineage();
  ALTER TABLE checklist_template DROP CONSTRAINT IF EXISTS checklist_template_project_tenant;
  ALTER TABLE checklist_template DROP COLUMN IF EXISTS retired_at;
  ALTER TABLE checklist_template DROP COLUMN IF EXISTS lineage_id;
  ALTER TABLE checklist_template DROP COLUMN IF EXISTS project_id;
END $$;

COMMIT;
