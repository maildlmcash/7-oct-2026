-- Rollback for 0009_provider_vault_references.sql.
-- Apply this before the 0008 rollback. It does not drop provider rows or privileged_audit.

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.provider_registry') IS NULL THEN
    RETURN;
  END IF;
  EXECUTE 'ALTER TABLE provider_registry DROP CONSTRAINT IF EXISTS provider_registry_market_data_scope';
  EXECUTE 'ALTER TABLE provider_registry DROP CONSTRAINT IF EXISTS provider_registry_order_scope';
  EXECUTE 'ALTER TABLE provider_registry DROP CONSTRAINT IF EXISTS provider_registry_credentials_separate';
  EXECUTE 'ALTER TABLE provider_registry DROP CONSTRAINT IF EXISTS provider_registry_withdrawals_closed';
  EXECUTE 'ALTER TABLE provider_registry DROP COLUMN IF EXISTS market_data_vault_reference';
  EXECUTE 'ALTER TABLE provider_registry DROP COLUMN IF EXISTS market_data_scope';
  EXECUTE 'ALTER TABLE provider_registry DROP COLUMN IF EXISTS order_vault_reference';
  EXECUTE 'ALTER TABLE provider_registry DROP COLUMN IF EXISTS order_scope';
  EXECUTE 'ALTER TABLE provider_registry DROP COLUMN IF EXISTS withdrawals';
END $$;

COMMIT;
