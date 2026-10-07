-- Official documentation review for a provider.
-- The source names no staleness duration. stale is stored, not calculated.
-- An enabled row needs a documentation URL and a checked-at time.
-- This file stores no secret and does not open a connection.

BEGIN;

CREATE TABLE provider_documentation (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id bigint NOT NULL REFERENCES tenant (id),
  lineage_id bigint NOT NULL,
  documentation_url text,
  checked_at timestamptz,
  supported_products text,
  verification_owner text,
  enabled boolean NOT NULL,
  stale boolean NOT NULL,
  recorded_at timestamptz NOT NULL,
  CONSTRAINT provider_documentation_enabled_reviewed CHECK (
    enabled = false
    OR (
      documentation_url ~ '^https?://[^[:space:]@]+$'
      AND checked_at IS NOT NULL
      AND length(btrim(supported_products)) > 0
      AND length(btrim(verification_owner)) > 0
    )
  )
);

CREATE FUNCTION provider_documentation_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'provider documentation is append-only';
END;
$$;

CREATE TRIGGER provider_documentation_no_update
BEFORE UPDATE OR DELETE ON provider_documentation
FOR EACH ROW
EXECUTE FUNCTION provider_documentation_append_only();

CREATE TRIGGER provider_documentation_no_truncate
BEFORE TRUNCATE ON provider_documentation
FOR EACH STATEMENT
EXECUTE FUNCTION provider_documentation_append_only();

COMMIT;
