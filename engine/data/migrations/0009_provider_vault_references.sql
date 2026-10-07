-- Secret-manager references and permission scopes for provider records.
-- The source names no secret-manager product. These columns store a reference
-- and a scope, not a secret value.
-- Market-data scope is read-only. Order scope is order-capable and uses a
-- different reference. Withdrawals stay closed.

BEGIN;

ALTER TABLE provider_registry
  ADD COLUMN market_data_vault_reference text,
  ADD COLUMN market_data_scope text,
  ADD COLUMN order_vault_reference text,
  ADD COLUMN order_scope text,
  ADD COLUMN withdrawals boolean NOT NULL DEFAULT false;

ALTER TABLE provider_registry
  ADD CONSTRAINT provider_registry_market_data_scope CHECK (
    (
      market_data_vault_reference IS NULL
      AND market_data_scope IS NULL
    )
    OR (
      market_data_scope = 'read-only'
      AND length(btrim(market_data_vault_reference)) > 0
    )
  );

ALTER TABLE provider_registry
  ADD CONSTRAINT provider_registry_order_scope CHECK (
    (
      order_vault_reference IS NULL
      AND order_scope IS NULL
    )
    OR (
      order_scope = 'order-capable'
      AND length(btrim(order_vault_reference)) > 0
    )
  );

ALTER TABLE provider_registry
  ADD CONSTRAINT provider_registry_credentials_separate CHECK (
    market_data_vault_reference IS NULL
    OR order_vault_reference IS NULL
    OR btrim(market_data_vault_reference) <> btrim(order_vault_reference)
  );

ALTER TABLE provider_registry
  ADD CONSTRAINT provider_registry_withdrawals_closed CHECK (withdrawals = false);

CREATE OR REPLACE FUNCTION provider_registry_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'provider versions are not deleted';
  END IF;
  IF OLD.archived_at IS NOT NULL AND NEW.archived_at IS DISTINCT FROM OLD.archived_at THEN
    RAISE EXCEPTION 'archived provider versions stay archived';
  END IF;
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
    OR NEW.lineage_id IS DISTINCT FROM OLD.lineage_id
    OR NEW.kind IS DISTINCT FROM OLD.kind
    OR NEW.product IS DISTINCT FROM OLD.product
    OR NEW.channel IS DISTINCT FROM OLD.channel
    OR NEW.docs_reference IS DISTINCT FROM OLD.docs_reference
    OR NEW.region IS DISTINCT FROM OLD.region
    OR NEW.limits IS DISTINCT FROM OLD.limits
    OR NEW.heartbeat IS DISTINCT FROM OLD.heartbeat
    OR NEW.status IS DISTINCT FROM OLD.status
    OR NEW.last_error IS DISTINCT FROM OLD.last_error
    OR NEW.version IS DISTINCT FROM OLD.version
    OR NEW.market_data_vault_reference IS DISTINCT FROM OLD.market_data_vault_reference
    OR NEW.market_data_scope IS DISTINCT FROM OLD.market_data_scope
    OR NEW.order_vault_reference IS DISTINCT FROM OLD.order_vault_reference
    OR NEW.order_scope IS DISTINCT FROM OLD.order_scope
    OR NEW.withdrawals IS DISTINCT FROM OLD.withdrawals
  THEN
    RAISE EXCEPTION 'provider versions are append-only';
  END IF;
  IF NEW.archived_at IS NOT DISTINCT FROM OLD.archived_at THEN
    RAISE EXCEPTION 'provider versions are append-only';
  END IF;
  RETURN NEW;
END;
$$;

COMMIT;
