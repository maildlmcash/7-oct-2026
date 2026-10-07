-- Rollback for 0010_provider_actions.sql.
-- Apply this before the 0009 rollback. It does not drop privileged_audit.

BEGIN;

DROP TABLE IF EXISTS provider_action;
DROP FUNCTION IF EXISTS provider_action_append_only();

DO $$
BEGIN
  IF to_regclass('public.provider_registry') IS NULL THEN
    RETURN;
  END IF;
  EXECUTE 'ALTER TABLE provider_registry DROP CONSTRAINT IF EXISTS provider_registry_auto_start_off';
  EXECUTE 'ALTER TABLE provider_registry DROP COLUMN IF EXISTS auto_start';
END $$;

COMMIT;
