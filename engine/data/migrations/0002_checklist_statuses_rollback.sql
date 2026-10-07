-- Rollback for 0002_checklist_statuses.sql.
-- Apply this before 0001_checklist_entities_rollback.sql.
-- Rows in checklist_dependency are deleted. Other checklist rows stay.
-- The alters are skipped when 0001 has not been applied.

BEGIN;

DROP TABLE IF EXISTS checklist_dependency;

DO $$
BEGIN
  IF to_regclass('public.checklist_item') IS NULL THEN
    RETURN;
  END IF;

  ALTER TABLE checklist_item DROP CONSTRAINT IF EXISTS checklist_item_pass_approver;
  ALTER TABLE checklist_item DROP COLUMN IF EXISTS pass_approver;
  ALTER TABLE checklist_item DROP CONSTRAINT IF EXISTS checklist_item_status_known;
  ALTER TABLE checklist_item DROP CONSTRAINT IF EXISTS checklist_item_not_applicable;
  ALTER TABLE checklist_item
    ADD CONSTRAINT checklist_item_not_applicable CHECK (
      status <> 'NOT_APPLICABLE'
      OR (
        length(btrim(not_applicable_reason)) > 0
        AND length(btrim(not_applicable_approver)) > 0
      )
    );

  IF to_regclass('public.check_run') IS NOT NULL THEN
    ALTER TABLE check_run DROP CONSTRAINT IF EXISTS check_run_result_known;
  END IF;
END $$;

COMMIT;
