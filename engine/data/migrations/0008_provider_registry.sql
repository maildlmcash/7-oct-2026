-- Versioned provider registry.
-- Kinds are CEX, DEX, chain, market-data API, and WebSocket.
-- Limits and heartbeat are text. The source names no numeric limit or interval.
-- Status is text. The source names no provider status vocabulary.
-- A change is a new row. Archive sets archived_at and does not delete the row.
-- This file stores no secret and does not open a network connection.

BEGIN;

CREATE TABLE provider_registry (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id bigint NOT NULL REFERENCES tenant (id),
  lineage_id bigint,
  kind text NOT NULL,
  product text NOT NULL,
  channel text NOT NULL,
  docs_reference text NOT NULL,
  region text NOT NULL,
  limits text,
  heartbeat text,
  status text NOT NULL,
  last_error text,
  version text NOT NULL,
  archived_at timestamptz,
  UNIQUE (id, tenant_id),
  CONSTRAINT provider_registry_kind_known CHECK (
    kind IN ('CEX', 'DEX', 'chain', 'market-data API', 'WebSocket')
  ),
  CONSTRAINT provider_registry_text_present CHECK (
    length(btrim(product)) > 0
    AND length(btrim(channel)) > 0
    AND length(btrim(docs_reference)) > 0
    AND length(btrim(region)) > 0
    AND length(btrim(status)) > 0
    AND length(btrim(version)) > 0
    AND (limits IS NULL OR length(btrim(limits)) > 0)
    AND (heartbeat IS NULL OR length(btrim(heartbeat)) > 0)
    AND (last_error IS NULL OR length(btrim(last_error)) > 0)
  )
);

CREATE FUNCTION provider_registry_lineage()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.lineage_id IS NULL THEN
    NEW.lineage_id := NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER provider_registry_lineage
BEFORE INSERT ON provider_registry
FOR EACH ROW
EXECUTE FUNCTION provider_registry_lineage();

ALTER TABLE provider_registry ALTER COLUMN lineage_id SET NOT NULL;

CREATE FUNCTION provider_registry_immutable()
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
  THEN
    RAISE EXCEPTION 'provider versions are append-only';
  END IF;
  IF NEW.archived_at IS NOT DISTINCT FROM OLD.archived_at THEN
    RAISE EXCEPTION 'provider versions are append-only';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER provider_registry_no_rewrite
BEFORE UPDATE OR DELETE ON provider_registry
FOR EACH ROW
EXECUTE FUNCTION provider_registry_immutable();

COMMIT;
