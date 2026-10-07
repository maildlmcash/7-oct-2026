-- Rollback for 0005_checklist_runs.sql.
-- Apply this before the 0004, 0003, 0002, and 0001 rollbacks.

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.check_run') IS NULL THEN
    RETURN;
  END IF;

  DROP TRIGGER IF EXISTS check_run_evidence_url_no_update ON check_run;
  DROP TRIGGER IF EXISTS evidence_reference_no_truncate ON evidence;
  DROP TRIGGER IF EXISTS evidence_reference_no_update ON evidence;
  DROP INDEX IF EXISTS check_run_request_once;
  ALTER TABLE check_run DROP CONSTRAINT IF EXISTS check_run_destructive_isolated;
  ALTER TABLE check_run DROP CONSTRAINT IF EXISTS check_run_request_fields;
  ALTER TABLE check_run DROP CONSTRAINT IF EXISTS check_run_path_known;
  ALTER TABLE check_run DROP COLUMN IF EXISTS isolated_test_environment;
  ALTER TABLE check_run DROP COLUMN IF EXISTS destructive_enabled;
  ALTER TABLE check_run DROP COLUMN IF EXISTS run_path;
END $$;

DROP FUNCTION IF EXISTS check_run_evidence_url_immutable();
DROP FUNCTION IF EXISTS evidence_reference_immutable();

COMMIT;
